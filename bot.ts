import { Bot, InlineKeyboard, GrammyError, HttpError, Context } from "grammy";
import cron from "node-cron";
import * as dotenv from "dotenv";
import { db } from "./db";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  CollectionReference,
} from "firebase/firestore";

dotenv.config();

type Username = string | number;

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN не найден в переменных окружения!");
}

const bot = new Bot<Context>(BOT_TOKEN);

const allowedUsersCollection: CollectionReference = collection(
  db,
  "allowedUsers"
);
const adminsCollection: CollectionReference = collection(db, "admins");
const reviewers: CollectionReference = collection(db, "reviewers");

async function addUserToFirebase(
  collectionRef: CollectionReference,
  username: Username
): Promise<void> {
  try {
    await addDoc(collectionRef, { username });
  } catch (error) {
    console.error("Ошибка при добавлении пользователя в Firebase:", error);
  }
}

async function removeUserFromFirebase(
  collectionRef: CollectionReference,
  username: Username
): Promise<void> {
  try {
    const querySnapshot = await getDocs(collectionRef);
    querySnapshot.forEach(async (docSnapshot) => {
      if (docSnapshot.data().username === username) {
        await deleteDoc(doc(db, collectionRef.id, docSnapshot.id));
      }
    });
  } catch (error) {
    console.error("Ошибка при удалении пользователя из Firebase:", error);
  }
}

async function getUsersFromFirebase(
  collectionRef: CollectionReference
): Promise<Set<Username>> {
  const users = new Set<Username>();
  try {
    const querySnapshot = await getDocs(collectionRef);
    querySnapshot.forEach((docSnapshot) => {
      users.add(docSnapshot.data().username);
    });
  } catch (error) {
    console.error("Ошибка при получении пользователей из Firebase:", error);
  }
  return users;
}

async function sendWeeklyReminder(): Promise<void> {
  const allowedUsers = await getUsersFromFirebase(allowedUsersCollection);
  const keyboard = new InlineKeyboard()
    .text("Ревьюер", "reviewer")
    .text("Не ревьюер", "not_reviewer");

  allowedUsers.forEach((username) => {
    bot.api
      .sendMessage(username, "Выберите вашу роль на эту неделю:", {
        reply_markup: keyboard,
      })
      .catch((err) =>
        console.error(
          `Не удалось отправить сообщение пользователю ${username}:`,
          err
        )
      );
  });
}

cron.schedule("0 9 * * 1", sendWeeklyReminder);

bot.command("start", async (ctx) => {
  const username = ctx.from?.username;
  if (!username) return;

  const allowedUsers = await getUsersFromFirebase(allowedUsersCollection);
  const admins = await getUsersFromFirebase(adminsCollection);

  if (allowedUsers.has(username)) {
    const keyboard = new InlineKeyboard()
      .text("Ревьюер", "reviewer")
      .text("Не ревьюер", "not_reviewer");

    ctx.reply("Привет! Выберите вашу роль на эту неделю:", {
      reply_markup: keyboard,
    });
  } else if (admins.has(username)) {
    ctx.reply(
      "Привет, Админ! Используйте команды /adduser <username> и /removeuser <username> для управления пользователями."
    );
  } else {
    ctx.reply("У вас нет доступа к этому боту. Обратитесь к администратору.");
  }
});

bot.command("adduser", async (ctx) => {
  const username = ctx.from?.username;
  if (!username) return;

  const admins = await getUsersFromFirebase(adminsCollection);
  if (!admins.has(username)) {
    return ctx.reply("У вас нет прав для выполнения этой команды.");
  }

  const newUser = ctx.message?.text?.split(" ")[1];
  if (!newUser) {
    return ctx.reply(
      "Пожалуйста, укажите username пользователя для добавления. Пример: /adduser username"
    );
  }

  await addUserToFirebase(allowedUsersCollection, newUser);
  ctx.reply(`Пользователь @${newUser} был добавлен в список разрешенных.`);
});

bot.command("removeuser", async (ctx) => {
  const username = ctx.from?.username;
  if (!username) return;

  const admins = await getUsersFromFirebase(adminsCollection);
  if (!admins.has(username)) {
    return ctx.reply("У вас нет прав для выполнения этой команды.");
  }

  const removeUser = ctx.message?.text?.split(" ")[1];
  if (!removeUser) {
    return ctx.reply(
      "Пожалуйста, укажите username пользователя для удаления. Пример: /removeuser username"
    );
  }

  await removeUserFromFirebase(allowedUsersCollection, removeUser);
  ctx.reply(`Пользователь @${removeUser} был удален из списка разрешенных.`);
});

bot.callbackQuery("reviewer", async (ctx) => {
  const username = ctx.from?.username;
  if (username) {
    await addUserToFirebase(reviewers, ctx.from.id);
    ctx
      .answerCallbackQuery("Вы записаны как ревьюер на эту неделю.")
      .catch((err) => console.error("Ошибка при ответе на callback:", err));
  }
});

bot.callbackQuery("not_reviewer", async (ctx) => {
  const username = ctx.from?.username;
  if (username) {
    await removeUserFromFirebase(reviewers, ctx.from.id);
    ctx
      .answerCallbackQuery("Вы записаны как не ревьюер на эту неделю.")
      .catch((err) => console.error("Ошибка при ответе на callback:", err));
  }
});

bot.on("message", async (ctx) => {
  const username = ctx.from?.username;
  const review_users = await getUsersFromFirebase(reviewers);
  const allowed_users = await getUsersFromFirebase(allowedUsersCollection);
  if (username && !review_users.has(username) && allowed_users.has(username)) {
    review_users.forEach((reviewerUsername) => {
      if (reviewerUsername !== ctx.from.id) {
        bot.api
          .sendMessage(
            reviewerUsername,
            `Сообщение от @${username}: ${ctx.message.text}`
          )
          .catch((err) =>
            console.error(
              `Ошибка при отправке сообщения ревьюеру ${reviewerUsername}:`,
              err
            )
          );
      }
    });
  }
});

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(
    `Произошла ошибка при обработке обновления ${ctx.update.update_id}:`,
    err.error
  );
  if (err.error instanceof GrammyError) {
    console.error("Ошибка в Telegram API:", err.error.description);
  } else if (err.error instanceof HttpError) {
    console.error("Ошибка в сети:", err.error);
  } else {
    console.error("Неизвестная ошибка:", err.error);
  }
});

bot.start();
