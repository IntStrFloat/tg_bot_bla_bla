import { Bot, InlineKeyboard, Context, GrammyError, HttpError } from 'grammy';
import cron from 'node-cron';
import * as dotenv from 'dotenv';

dotenv.config();

type Username = string;

const bot = new Bot<Context>(`${process.env.BOT_TOKEN}`);

const ADMIN_USERNAME: Username = 'strrrrr1' || 'fac_ele_ss';

const reviewers: Set<number> = new Set();
const allowedUsers: Set<Username> = new Set([
  'Crewch',
  'fac_ele_ss',
  'g_grm',
  'valdislav_1',
  'strrrrr1',
]);

function sendWeeklyReminder() {
  const keyboard = new InlineKeyboard()
    .text('Ревьюер', 'reviewer')
    .text('Не ревьюер', 'not_reviewer');
  allowedUsers.forEach((username) => {
    bot.api
      .sendMessage(username, 'Выберите вашу роль на эту неделю:', { reply_markup: keyboard })
      .catch((err) =>
        console.error(`Не удалось отправить сообщение пользователю ${username}:`, err),
      );
  });
}

cron.schedule('0 9 * * 1', sendWeeklyReminder);

bot.command('start', (ctx) => {
  const username = ctx.from?.username;
  if (!username) return;
  const keyboard = new InlineKeyboard()
    .text('Ревьюер', 'reviewer')
    .text('Не ревьюер', 'not_reviewer');

  if (username === ADMIN_USERNAME) {
    ctx.reply(
      'Привет, Админ! Используйте команды /adduser <username> и /removeuser <username> для управления пользователями. И не забудь выбрать свою роль на эту неделю',
      { reply_markup: keyboard },
    );
  } else if (allowedUsers.has(username)) {
    ctx.reply('Привет! Выберите вашу роль на эту неделю:', { reply_markup: keyboard });
  } else {
    ctx.reply('У вас нет доступа к этому боту. Обратитесь к администратору.');
  }
});

bot.command('adduser', (ctx) => {
  const username = ctx.from?.username;
  if (username !== ADMIN_USERNAME) {
    return ctx.reply('У вас нет прав для выполнения этой команды.');
  }
  const newUser = ctx.message?.text?.split(' ')[1];
  if (!newUser) {
    return ctx.reply(
      'Пожалуйста, укажите username пользователя для добавления. Пример: /adduser username',
    );
  }
  allowedUsers.add(newUser);
  ctx.reply(`Пользователь @${newUser} был добавлен в список разрешенных.`);
});

bot.command('removeuser', (ctx) => {
  const username = ctx.from?.username;
  if (username !== ADMIN_USERNAME) {
    return ctx.reply('У вас нет прав для выполнения этой команды.');
  }
  const removeUser = ctx.message?.text?.split(' ')[1];
  if (!removeUser) {
    return ctx.reply(
      'Пожалуйста, укажите username пользователя для удаления. Пример: /removeuser username',
    );
  }
  allowedUsers.delete(removeUser);
  ctx.reply(`Пользователь @${removeUser} был удален из списка разрешенных.`);
});

bot.callbackQuery('reviewer', (ctx) => {
  const username = ctx.from?.username;
  if (username && allowedUsers.has(username)) {
    reviewers.add(ctx.from!.id);
    ctx
      .answerCallbackQuery('Вы записаны как ревьюер на эту неделю.')
      .catch((err) => console.error('Ошибка при ответе на callback:', err));
  }
});

bot.callbackQuery('not_reviewer', (ctx) => {
  const username = ctx.from?.username;
  if (username && allowedUsers.has(username)) {
    reviewers.delete(ctx.from.id);
    ctx
      .answerCallbackQuery('Вы записаны как не ревьюер на эту неделю.')
      .catch((err) => console.error('Ошибка при ответе на callback:', err));
  }
});

bot.on('message', (ctx) => {
  const username = ctx.from?.username;
  if (username && !reviewers.has(ctx.from.id) && allowedUsers.has(username)) {
    // Если пользователь не ревьюер
    reviewers.forEach((reviewerUsername) => {
      if (reviewerUsername !== ctx.from.id) {
        // Не отправляем самому себе
        bot.api
          .sendMessage(reviewerUsername, `Сообщение от @${username}: ${ctx.message.text}`)
          .catch((err) =>
            console.error(`Ошибка при отправке сообщения ревьюеру ${reviewerUsername}:`, err),
          );
      }
    });
  }
});

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Произошла ошибка при обработке обновления ${ctx.update.update_id}:`, err.error);
  if (err.error instanceof GrammyError) {
    console.error('Ошибка в Telegram API:', err.error.description);
  } else if (err.error instanceof HttpError) {
    console.error('Ошибка в сети:', err.error);
  } else {
    console.error('Неизвестная ошибка:', err.error);
  }
});

bot.start();
