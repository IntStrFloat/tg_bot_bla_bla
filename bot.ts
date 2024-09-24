import { Bot, InlineKeyboard, GrammyError, HttpError, Context } from "grammy";
import cron from "node-cron";
import * as dotenv from "dotenv";
import { db } from "./db";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  CollectionReference,
  doc,
} from "firebase/firestore";

dotenv.config();

cron.schedule("01 9,13,16 * * *", sendWeeklyReminder);
cron.schedule("* * * * * ", updateWeeklyReviewers); // Понедельник, 9:00
type User = {
  userName: string;
  chatId: number;
};

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
const currentTabIndex: CollectionReference = collection(db, "reviewIndex");

const reviewersSchedule = [
  ["fac_ele_ss", "g_grm", "Crewch"],
  ["g_grm", "Crewch", "valdislav_1"],
  ["Crewch", "valdislav_1", "strrrrr1"],
  ["valdislav_1", "strrrrr1", "fac_ele_ss"],
  ["strrrrr1", "fac_ele_ss", "g_grm"],
];

let currentWeekIndex: number;

async function updateWeeklyReviewers() {
  let tabs = new Array<number>();
  const snapshot = await getDocs(currentTabIndex);
  snapshot.forEach((elem) => tabs.push(elem.data().tab as number));

  currentWeekIndex = tabs[0];
  const currentReviewers = reviewersSchedule[currentWeekIndex];

  console.log("Текущие проверяющие:", currentReviewers);

  currentWeekIndex = (currentWeekIndex + 1) % reviewersSchedule.length;

  snapshot.forEach(async (docSnapshot) => {
    await deleteDoc(doc(db, currentTabIndex.id, docSnapshot.id));
  });

  await addDoc(currentTabIndex, { tab: currentWeekIndex });
}

async function addUserToFirebase(
  collectionRef: CollectionReference,
  user: User
): Promise<void> {
  try {
    await addDoc(collectionRef, user);
  } catch (error) {
    console.error("Ошибка при добавлении пользователя в Firebase:", error);
  }
}

async function removeUserFromFirebase(
  collectionRef: CollectionReference,
  user: User
): Promise<void> {
  try {
    const querySnapshot = await getDocs(collectionRef);
    querySnapshot.forEach(async (docSnapshot) => {
      if (docSnapshot.data().chatId === user.chatId) {
        await deleteDoc(doc(db, collectionRef.id, docSnapshot.id));
      }
    });
  } catch (error) {
    console.error("Ошибка при удалении пользователя из Firebase:", error);
  }
}

async function getUsersFromFirebase(
  collectionRef: CollectionReference
): Promise<Array<User>> {
  const users = new Array<User>();
  try {
    const querySnapshot = await getDocs(collectionRef);
    querySnapshot.forEach((docSnapshot) => {
      users.push(docSnapshot.data() as User);
    });
  } catch (error) {
    console.error("Ошибка при получении пользователей из Firebase:", error);
  }
  return users;
}

async function sendWeeklyReminder(): Promise<void> {
  const allowedUsers = await getUsersFromFirebase(allowedUsersCollection);

  allowedUsers.forEach((username) => {
    if (reviewersSchedule[currentWeekIndex].includes(username.userName)) {
      bot.api
        .sendMessage(
          username.chatId,
          `Привет, @${username.userName} - посмотри пр-ы :)`
        )
        .catch((err) =>
          console.error(
            `Не удалось отправить сообщение пользователю ${username.userName}:`,
            err
          )
        );
    }
  });
}

bot.command("start", async (ctx) => {
  const username = ctx.from?.username;
  if (!username) return;
  console.log(ctx.from?.id);
  const allowedUsers = await getUsersFromFirebase(allowedUsersCollection);
  console.log(allowedUsers);
  const userNames = allowedUsers?.map((el) => el.userName);
  const admins = await getUsersFromFirebase(adminsCollection);
  console.log(admins);
  if (userNames.includes(username)) {
    const realy_user = {
      userName: username,
      chatId: ctx.from?.id!,
    };
    const isInvalidUser = allowedUsers.find((el) => el.chatId == 0);
    if (isInvalidUser) {
      await removeUserFromFirebase(allowedUsersCollection, {
        userName: username,
        chatId: 0,
      });
      await addUserToFirebase(allowedUsersCollection, realy_user);
    }

    const keyboard = new InlineKeyboard()
      .text("Ревьюер", "reviewer")
      .text("Не ревьюер", "not_reviewer");

    ctx.reply("Привет! Выберите вашу роль на эту неделю:", {
      reply_markup: keyboard,
    });
  } else if (admins.map((el) => el.userName).includes(username)) {
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

  const admins = (await getUsersFromFirebase(adminsCollection)).map(
    (admin) => admin.userName
  );
  if (!admins.includes(username)) {
    return ctx.reply("У вас нет прав для выполнения этой команды.");
  }
  console.log(123123123);
  const newUser: User = {
    userName: ctx.message?.text?.split(" ")[1]!,
    chatId: 0,
  };

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

  const admins = (await getUsersFromFirebase(adminsCollection)).map(
    (admin) => admin.userName
  );
  if (!admins.includes(username)) {
    return ctx.reply("У вас нет прав для выполнения этой команды.");
  }

  const removeUser = {
    userName: ctx.message?.text?.split(" ")[1]!,
    chatId: ctx.from?.id!,
  };

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
    const review_users = (await getUsersFromFirebase(reviewers)).map(
      (reviewers) => reviewers.chatId
    );
    console.log(review_users);
    if (!review_users.includes(ctx.from.id)) {
      await addUserToFirebase(reviewers, {
        userName: ctx.from.username!,
        chatId: ctx.from.id!,
      });
      ctx
        .answerCallbackQuery("Вы записаны как ревьюер на эту неделю.")
        .catch((err) => console.error("Ошибка при ответе на callback:", err));
    }
  }
});

bot.callbackQuery("not_reviewer", async (ctx) => {
  const username = ctx.from?.username;
  if (username) {
    await removeUserFromFirebase(reviewers, {
      userName: username!,
      chatId: ctx.from.id,
    });
    ctx
      .answerCallbackQuery("Вы записаны как не ревьюер на эту неделю.")
      .catch((err) => console.error("Ошибка при ответе на callback:", err));
  }
});

bot.on("message", async (ctx) => {
  const username = ctx.from?.username;
  const review_users = await getUsersFromFirebase(reviewers);
  const allowed_users = (
    await getUsersFromFirebase(allowedUsersCollection)
  ).map((user) => user.userName);

  if (
    username &&
    !review_users.map((elem) => elem.userName).includes(username) &&
    allowed_users.includes(username)
  ) {
    review_users.forEach((reviewerUsername) => {
      if (reviewerUsername.chatId !== ctx.from.id) {
        bot.api
          .sendMessage(
            reviewerUsername.chatId,
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
