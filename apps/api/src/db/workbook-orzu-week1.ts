/**
 * ORZU MEDICAL × AIRL · Урок 1 «Строим мини-проект с ИИ за 7 шагов».
 *
 * Example project: a clinic request tracker. Each step = slide + plain-
 * language explanation + the real prompts and files (IDEA.md, PRD.md,
 * TASKS.md) + exercises. Every block is bilingual: Russian first, Uzbek
 * (Latin script) below.
 *
 * Images are static assets in `apps/web/public/workbook/orzu/`:
 *   step-0..7.png     — lesson slides (AIRL style, RU + UZ, 1600×900)
 *   slide-tilmoch.png — «Перевод на узбекский в вашем телефоне» (deck slide 2)
 *   tilmoch-qr.png    — clean QR → https://tilmoch-eight.vercel.app
 */
import type { SeedBlock } from './workbook-day1';

export const TILMOCH_URL = 'https://tilmoch-eight.vercel.app';

/** Russian block followed by its Uzbek translation. The UZ title line is
 * bolded so it reads as a heading like the RU first line does. */
const bi = (ru: string, uz: string): string => {
  const [title, ...rest] = uz.split('\n');
  return [`${ru}\n\n**${title}**`, ...rest].join('\n');
};
/** Input prompt: first line (RU) renders bold, the UZ line under it. */
const label = (ru: string, uz: string): string => `${ru}\n${uz}`;
/** Choice text shown in both languages. */
const opt = (ru: string, uz: string): string => `${ru} · ${uz}`;

const t = (ru: string, uz: string, blockRole = 'intro'): SeedBlock => ({
  type: 'text',
  content: bi(ru, uz),
  blockRole,
});
const img = (file: string, alt: string): SeedBlock => ({
  type: 'image',
  imageUrl: `/workbook/orzu/${file}`,
  content: alt,
  blockRole: 'slide',
});
const ask = (ru: string, uz: string, blockRole = 'exercise'): SeedBlock => ({
  type: 'input_text',
  content: label(ru, uz),
  blockRole,
});
const pick = (ru: string, uz: string, choices: string[]): SeedBlock => ({
  type: 'input_select',
  content: label(ru, uz),
  options: { choices },
  blockRole: 'exercise',
});
const quiz = (
  ru: string,
  uz: string,
  choices: string[],
  correctIndex: number,
): SeedBlock => ({
  type: 'test',
  options: { question: label(ru, uz), choices, correctIndex },
  blockRole: 'exercise',
});
const rate = (ru: string, uz: string): SeedBlock => ({
  type: 'input_rating',
  content: label(ru, uz),
  options: { min: 1, max: 5 },
  blockRole: 'reflection',
});
const fileAsk = (ru: string, uz: string): SeedBlock => ({
  type: 'input_file',
  content: label(ru, uz),
  blockRole: 'task',
});
const checklist = (ru: string, uz: string, items: string[]): SeedBlock => ({
  type: 'checklist',
  content: label(ru, uz),
  options: { items },
  blockRole: 'task',
});
const btn = (label: string, href: string): SeedBlock => ({
  type: 'action_button',
  options: { label, href },
  blockRole: 'task',
});

export const ORZU_WEEK1_WORKBOOK: SeedBlock[] = [
  // ═══════════════════════════════════════════════════════════════════
  // СТАРТ · о чём урок, перевод, правила
  // ═══════════════════════════════════════════════════════════════════
  t(
    'ORZU MEDICAL × AIRL · УРОК 1\nСтроим мини-проект с ИИ за 7 шагов\n\nСегодня на простом примере — **трекере заявок клиники** — пройдём весь путь: от идеи на одной странице до первой задачи, которую сделает ИИ-агент. Программировать уметь не нужно: мы показываем настоящие промпты и файлы, а вы повторяете за нами в своём проекте.\n\nПосле каждого шага — короткое упражнение. Пишете ответ, нажимаете «Отправить» — блок отмечается «Сдано ✓».',
    'ORZU MEDICAL × AIRL · 1-DARS\nSunʼiy intellekt bilan mini-loyiha — 7 qadamda\n\nBugun oddiy misolda — **klinika arizalari trekeri** — butun yoʻlni bosib oʻtamiz: bir sahifalik gʻoyadan SI-agent bajaradigan birinchi vazifagacha. Dasturlashni bilish shart emas: biz haqiqiy promptlar va fayllarni koʻrsatamiz, siz esa oʻz loyihangizda takrorlaysiz.\n\nHar bir qadamdan keyin — qisqa mashq. Javob yozasiz, «Yuborish»ni bosasiz — blok «Topshirildi ✓» deb belgilanadi.',
    'agenda',
  ),
  t(
    'СИНХРОННЫЙ ПЕРЕВОД НА УЗБЕКСКИЙ\nСпикер говорит по-русски или по-казахски — перевод появляется у вас в телефоне сразу. Без установки и регистрации.\n1. Отсканируйте QR-код.\n2. Введите код эфира — его назовёт спикер.\n3. Читайте перевод на узбекском или включите «Ovoz».',
    'JONLI TARJIMA — OʻZBEK TILIGA\nSpiker rus yoki qozoq tilida gapiradi — tarjima darhol telefoningizda paydo boʻladi. Oʻrnatish va roʻyxatdan oʻtish shart emas.\n1. QR-kodni telefoningiz bilan skanerlang.\n2. Efir kodini kiriting — uni spiker aytadi.\n3. Tarjimani oʻqing yoki «Ovoz» bilan tinglang.',
  ),
  img(
    'slide-tilmoch.png',
    'Перевод на узбекский в вашем телефоне · Oʻzbek tiliga jonli tarjima — Tilmoch',
  ),
  btn('Открыть Tilmoch · Tilmochni ochish', TILMOCH_URL),
  img('tilmoch-qr.png', 'QR-код Tilmoch · Tilmoch QR-kodi — tilmoch-eight.vercel.app'),
  t(
    'КАК ПРОХОДИТ УРОК\n1. **Видеосвязь** подключается автоматически, когда её запускает преподаватель. Микрофон и камера выключены — включите, когда дадут слово. При прокрутке видео остаётся в углу экрана.\n2. **Вопросы** — во вкладке «Вопросы»: задайте свой и поддержите ▲ вопросы коллег.\n3. **Упражнения** — пишите ответ прямо здесь и нажимайте «Отправить».\n4. **Безопасность:** никогда не вставляйте в чат с ИИ пароли, ключи и данные пациентов.',
    'DARS QANDAY OʻTADI\n1. **Videoaloqa** oʻqituvchi boshlaganda avtomatik ulanadi. Mikrofon va kamera oʻchiq — soʻz berilganda yoqing. Sahifani aylantirganda video ekran burchagida qoladi.\n2. **Savollar** — «Savollar» boʻlimida: oʻz savolingizni bering va hamkasblar savollariga ▲ ovoz bering.\n3. **Mashqlar** — javobni shu yerda yozing va «Yuborish»ni bosing.\n4. **Xavfsizlik:** SI chatiga hech qachon parollar, kalitlar va bemorlar maʼlumotlarini qoʻymang.',
  ),
  img('step-0.png', 'Строим мини-проект с ИИ — 7 шагов · Sunʼiy intellekt bilan mini-loyiha — 7 qadam'),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 1 · ИДЕЯ НА ОДНУ СТРАНИЦУ
  // ═══════════════════════════════════════════════════════════════════
  img('step-1.png', 'Шаг 1 · Идея на одну страницу · 1-qadam · Bir sahifalik gʻoya'),
  t(
    'ШАГ 1 · ИДЕЯ НА ОДНУ СТРАНИЦУ\nПрежде чем просить ИИ что-то сделать, ответьте на три вопроса:\n• **Пользователь** — кто будет пользоваться? Конкретная роль, а не «все».\n• **Проблема** — что сейчас неудобно или теряется?\n• **Метрика успеха** — по какой цифре поймём, что стало лучше?\n\nЕсли ответ не помещается на одну страницу — идея слишком большая для первого проекта. Урежьте её.',
    '1-QADAM · BIR SAHIFALIK GʻOYA\nSI dan biror narsa soʻrashdan oldin uchta savolga javob bering:\n• **Foydalanuvchi** — kim foydalanadi? «Hamma» emas, aniq rol.\n• **Muammo** — hozir nima noqulay yoki nima yoʻqoladi?\n• **Muvaffaqiyat oʻlchovi** — yaxshilanganini qaysi raqam bilan bilamiz?\n\nJavob bir sahifaga sigʻmasa — gʻoya birinchi loyiha uchun juda katta. Uni qisqartiring.',
  ),
  t(
    'ПРОМПТ · копируйте в чат с Claude\nПомоги мне описать идею мини-проекта на одну страницу. Задавай мне вопросы по одному, пока не узнаешь: кто пользователь, какую проблему решаем и по какой метрике поймём, что стало лучше. Потом собери ответ в файл docs/IDEA.md: заголовок, три раздела, не больше 15 строк. Пиши простым языком, без технических терминов.',
    'PROMPT · Claude chatiga nusxalang\nMenga mini-loyiha gʻoyasini bir sahifada tasvirlashga yordam ber. Foydalanuvchi kimligini, qaysi muammoni hal qilishimizni va yaxshilanganini qaysi oʻlchov bilan bilishimizni aniqlamaguningizcha savollarni bittadan ber. Keyin javobni docs/IDEA.md fayliga yigʻ: sarlavha, uchta boʻlim, 15 qatordan oshmasin. Oddiy tilda, texnik atamalarsiz yoz.',
  ),
  t(
    'ФАЙЛ · docs/IDEA.md — что получилось у нас\n# Трекер заявок клиники\nПользователь: администратор call-центра.\nПроблема: заявки приходят в WhatsApp, Instagram и по телефону, записываются в тетрадь и теряются.\nМетрика успеха: каждая заявка получает ответ за 15 минут; ни одна не потеряна.',
    'FAYL · docs/IDEA.md — bizda nima chiqdi\n# Klinika arizalari trekeri\nFoydalanuvchi: call-markaz administratori.\nMuammo: arizalar WhatsApp, Instagram va telefon orqali keladi, daftarga yoziladi va yoʻqoladi.\nMuvaffaqiyat oʻlchovi: har bir arizaga 15 daqiqada javob beriladi; birortasi ham yoʻqolmaydi.',
  ),
  ask(
    'Упражнение 1.1 · Кто пользователь вашего мини-проекта?',
    '1.1-mashq · Mini-loyihangiz foydalanuvchisi kim?',
  ),
  ask(
    'Упражнение 1.2 · Какую проблему он решает? Одной-двумя фразами',
    '1.2-mashq · U qaysi muammoni hal qiladi? Bir-ikki jumlada',
  ),
  ask(
    'Упражнение 1.3 · Метрика успеха: по какой цифре поймёте, что стало лучше?',
    '1.3-mashq · Muvaffaqiyat oʻlchovi: yaxshilanganini qaysi raqam bilan bilasiz?',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 2 · МИНИ-PRD ВМЕСТЕ С ИИ
  // ═══════════════════════════════════════════════════════════════════
  img('step-2.png', 'Шаг 2 · Мини-PRD вместе с ИИ · 2-qadam · SI bilan mini-PRD'),
  t(
    'ШАГ 2 · МИНИ-PRD ВМЕСТЕ С ИИ\nPRD — это короткое техническое задание: что именно строим. В нём три части:\n• **MVP** — самый маленький набор функций, который уже полезен.\n• **Что НЕ делаем** — список, который защищает проект от разрастания.\n• **Критерии приёмки** — как проверить, что готово. Без них агент не знает, когда остановиться.\n\nИИ пишет черновик — вы вычёркиваете лишнее и решаете.',
    '2-QADAM · SI BILAN MINI-PRD\nPRD — qisqa texnik topshiriq: aynan nimani quramiz. Unda uch qism bor:\n• **MVP** — allaqachon foydali boʻlgan eng kichik funksiyalar toʻplami.\n• **Nima QILMAYMIZ** — loyihani kengayib ketishdan saqlaydigan roʻyxat.\n• **Qabul qilish mezonlari** — tayyorligini qanday tekshirish. Ularsiz agent qachon toʻxtashni bilmaydi.\n\nSI qoralama yozadi — siz ortiqchasini oʻchirasiz va qaror qilasiz.',
  ),
  t(
    'ПРОМПТ · копируйте в чат с Claude\nВот моя идея из docs/IDEA.md: [вставьте текст]. Напиши мини-PRD в файл docs/PRD.md. Разделы: 1) MVP — не больше 3 функций; 2) Что НЕ делаем в первой версии; 3) Критерии приёмки — проверяемые фразы вида «Пользователь может…»; 4) Правила для агента: делать одну задачу за раз, не добавлять функции вне MVP, не хранить ключи и пароли в коде. Пиши коротко и простым языком. Если чего-то не хватает — сначала спроси меня.',
    'PROMPT · Claude chatiga nusxalang\nMana docs/IDEA.md dagi gʻoyam: [matnni qoʻying]. docs/PRD.md fayliga mini-PRD yoz. Boʻlimlar: 1) MVP — 3 tadan koʻp boʻlmagan funksiya; 2) Birinchi versiyada nima QILMAYMIZ; 3) Qabul qilish mezonlari — «Foydalanuvchi … qila oladi» koʻrinishidagi tekshiriladigan jumlalar; 4) Agent uchun qoidalar: bir vaqtda bitta vazifa, MVP dan tashqari funksiya qoʻshmaslik, kalit va parollarni kodda saqlamaslik. Qisqa va oddiy tilda yoz. Biror narsa yetishmasa — avval mendan soʻra.',
  ),
  t(
    'ФАЙЛ · docs/PRD.md — что получилось у нас\n# PRD · Трекер заявок\n## MVP\n1. Форма «Новая заявка»: имя, телефон, источник.\n2. Список заявок со статусами: новая → в работе → записан / отказ.\n3. У каждой заявки есть ответственный.\n## Что НЕ делаем\nОплату, интеграцию с 1С, мобильное приложение, SMS.\n## Критерии приёмки\n• Администратор создаёт заявку меньше чем за 30 секунд.\n• Статус меняется в один клик.\n• Видно, кто отвечает за каждую заявку.\n## Правила для агента\nОдна задача за раз. Ничего вне MVP. Никаких ключей и паролей в коде.',
    'FAYL · docs/PRD.md — bizda nima chiqdi\n# PRD · Arizalar trekeri\n## MVP\n1. «Yangi ariza» shakli: ism, telefon, manba.\n2. Holatli arizalar roʻyxati: yangi → ishda → yozildi / rad etildi.\n3. Har bir arizaning masʼul xodimi bor.\n## Nima QILMAYMIZ\nToʻlov, 1C bilan integratsiya, mobil ilova, SMS.\n## Qabul qilish mezonlari\n• Administrator arizani 30 soniyadan kamroq vaqtda yaratadi.\n• Holat bir bosishda oʻzgaradi.\n• Har bir ariza uchun kim masʼulligi koʻrinadi.\n## Agent uchun qoidalar\nBir vaqtda bitta vazifa. MVP dan tashqari hech narsa. Kodda kalit va parollar yoʻq.',
  ),
  quiz(
    'Проверка · Что из этого НЕ должно попасть в MVP трекера заявок?',
    'Tekshiruv · Bulardan qaysi biri arizalar trekeri MVP siga KIRMASLIGI kerak?',
    [
      opt('Форма новой заявки', 'Yangi ariza shakli'),
      opt('Интеграция с 1С и оплатой', '1C va toʻlov bilan integratsiya'),
      opt('Список заявок со статусами', 'Holatli arizalar roʻyxati'),
    ],
    1,
  ),
  ask(
    'Упражнение 2.1 · MVP вашего проекта: не больше 3 функций',
    '2.1-mashq · Loyihangiz MVP si: 3 tadan koʻp boʻlmagan funksiya',
  ),
  ask(
    'Упражнение 2.2 · Что вы НЕ делаете в первой версии?',
    '2.2-mashq · Birinchi versiyada nima QILMAYSIZ?',
  ),
  ask(
    'Упражнение 2.3 · 2–3 критерия приёмки в виде «Пользователь может…»',
    '2.3-mashq · «Foydalanuvchi … qila oladi» koʻrinishidagi 2–3 ta qabul mezoni',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 3 · ПОДГОТОВКА ПРОЕКТА
  // ═══════════════════════════════════════════════════════════════════
  img('step-3.png', 'Шаг 3 · Подготовка проекта · 3-qadam · Loyihani tayyorlash'),
  t(
    'ШАГ 3 · ПОДГОТОВКА ПРОЕКТА\nПроект живёт в репозитории GitHub — это папка в интернете, которая помнит каждую версию.\n1. На github.com нажмите **New repository**, имя — например, tracker-zayavok, видимость — **Private**.\n2. Откройте репозиторий в VS Code и создайте папку **docs/**.\n3. Положите туда **IDEA.md** и **PRD.md** из шагов 1–2. PRD.md — это правила проекта: агент читает его перед каждой задачей.',
    '3-QADAM · LOYIHANI TAYYORLASH\nLoyiha GitHub repozitoriysida yashaydi — bu internetdagi papka, u har bir versiyani eslab qoladi.\n1. github.com da **New repository** ni bosing, nomi — masalan, tracker-zayavok, koʻrinish — **Private**.\n2. Repozitoriyni VS Code da oching va **docs/** papkasini yarating.\n3. Unga 1–2-qadamlardagi **IDEA.md** va **PRD.md** ni qoʻying. PRD.md — loyiha qoidalari: agent uni har bir vazifadan oldin oʻqiydi.',
  ),
  t(
    'ПРОМПТ · для агента Claude Code в VS Code\nСоздай в этом репозитории папку docs/ и файлы docs/IDEA.md и docs/PRD.md с текстом, который я пришлю. Добавь README.md: одна строка о проекте и ссылка на docs/PRD.md. Перед любой следующей задачей всегда читай docs/PRD.md и следуй его правилам. Ничего больше не делай и покажи, какие файлы создал.',
    'PROMPT · VS Code dagi Claude Code agenti uchun\nUshbu repozitoriyda docs/ papkasini va men yuboradigan matn bilan docs/IDEA.md hamda docs/PRD.md fayllarini yarat. README.md qoʻsh: loyiha haqida bitta qator va docs/PRD.md ga havola. Har qanday keyingi vazifadan oldin doim docs/PRD.md ni oʻqi va uning qoidalariga amal qil. Boshqa hech narsa qilma va qaysi fayllarni yaratganingni koʻrsat.',
  ),
  checklist('Упражнение 3.1 · Отметьте, что готово', '3.1-mashq · Tayyorlarini belgilang', [
    opt('Создан приватный репозиторий в GitHub', 'GitHubda yopiq (private) repozitoriy yaratildi'),
    opt('Есть папка docs/', 'docs/ papkasi bor'),
    opt('В docs/ лежат IDEA.md и PRD.md', 'docs/ ichida IDEA.md va PRD.md bor'),
    opt('В репозитории нет паролей, ключей и данных пациентов', 'Repozitoriyda parol, kalit va bemor maʼlumotlari yoʻq'),
  ]),
  ask(
    'Упражнение 3.2 · Ссылка на ваш репозиторий (тренер получит доступ по приглашению)',
    '3.2-mashq · Repozitoriyingiz havolasi (trener taklif orqali kirish oladi)',
    'task',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 4 · ПЛАН И МАЛЕНЬКИЕ ЗАДАЧИ
  // ═══════════════════════════════════════════════════════════════════
  img('step-4.png', 'Шаг 4 · План и маленькие задачи · 4-qadam · Reja va kichik vazifalar'),
  t(
    'ШАГ 4 · ПЛАН И МАЛЕНЬКИЕ ЗАДАЧИ\nАгент хорошо справляется с маленькими задачами и путается в больших. Правило: **одна задача = один результат, который вы проверите за 5 минут** — открыли, нажали, увидели.\n\nПлохо: «Сделай трекер заявок».\nХорошо: «Сделай форму новой заявки с полями имя, телефон, источник».',
    '4-QADAM · REJA VA KICHIK VAZIFALAR\nAgent kichik vazifalarni yaxshi bajaradi, kattalarida esa adashadi. Qoida: **bitta vazifa = 5 daqiqada tekshiradigan bitta natija** — ochdingiz, bosdingiz, koʻrdingiz.\n\nYomon: «Arizalar trekerini qil».\nYaxshi: «Ism, telefon, manba maydonlari bilan yangi ariza shaklini qil».',
  ),
  t(
    'ПРОМПТ · копируйте агенту\nПрочитай docs/PRD.md. Разбей MVP на 5–7 маленьких задач, каждую можно проверить за 5 минут без программирования. Для каждой напиши: что сделать и как я проверю результат. Сохрани список в docs/TASKS.md с чекбоксами «- [ ]». Код пока не пиши.',
    'PROMPT · agentga nusxalang\ndocs/PRD.md ni oʻqi. MVP ni 5–7 ta kichik vazifaga boʻl, har birini dasturlashsiz 5 daqiqada tekshirish mumkin boʻlsin. Har biri uchun yoz: nima qilish kerak va natijani qanday tekshiraman. Roʻyxatni «- [ ]» belgilari bilan docs/TASKS.md ga saqla. Hozircha kod yozma.',
  ),
  t(
    'ФАЙЛ · docs/TASKS.md — что получилось у нас\n- [ ] 1. Форма «Новая заявка»: имя, телефон, источник. Проверка: заполнить и увидеть заявку в списке.\n- [ ] 2. Список заявок с фильтром по статусу. Проверка: переключить фильтр.\n- [ ] 3. Смена статуса в один клик. Проверка: нажать и увидеть новый статус.\n- [ ] 4. Поле «Ответственный». Проверка: выбрать сотрудника.\n- [ ] 5. Подсветка заявок без ответа дольше 15 минут. Проверка: создать заявку и подождать.',
    'FAYL · docs/TASKS.md — bizda nima chiqdi\n- [ ] 1. «Yangi ariza» shakli: ism, telefon, manba. Tekshiruv: toʻldirib, arizani roʻyxatda koʻrish.\n- [ ] 2. Holat boʻyicha filtrli arizalar roʻyxati. Tekshiruv: filtrni almashtirish.\n- [ ] 3. Holatni bir bosishda oʻzgartirish. Tekshiruv: bosib, yangi holatni koʻrish.\n- [ ] 4. «Masʼul» maydoni. Tekshiruv: xodimni tanlash.\n- [ ] 5. 15 daqiqadan ortiq javobsiz arizalarni ajratish. Tekshiruv: ariza yaratib kutish.',
  ),
  quiz(
    'Проверка · Какая задача достаточно маленькая для агента?',
    'Tekshiruv · Qaysi vazifa agent uchun yetarlicha kichik?',
    [
      opt('Сделай CRM для всей клиники', 'Butun klinika uchun CRM qil'),
      opt('Добавь кнопку смены статуса заявки', 'Ariza holatini oʻzgartirish tugmasini qoʻsh'),
      opt('Сделай красиво и удобно', 'Chiroyli va qulay qil'),
    ],
    1,
  ),
  ask(
    'Упражнение 4.1 · Ваши первые 5 задач — по одной на строку, с тем, как вы их проверите',
    '4.1-mashq · Birinchi 5 ta vazifangiz — har bir qatorga bittadan, qanday tekshirishingiz bilan',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 5 · ПЕРВЫЙ ЦИКЛ
  // ═══════════════════════════════════════════════════════════════════
  img('step-5.png', 'Шаг 5 · Первый цикл · 5-qadam · Birinchi sikl'),
  t(
    'ШАГ 5 · ПЕРВЫЙ ЦИКЛ: ЗАДАЧА → ПРОВЕРКА → ФИКСАЦИЯ\n1. **Ставим задачу** — одну, из TASKS.md.\n2. **Агент делает** — читает PRD.md и пишет код. Ожидание можно пропустить, пока агент работает.\n3. **Проверяем сами** — открываем и пробуем так, как сделал бы пользователь.\n4. **Фиксируем** — commit в GitHub и галочка в TASKS.md. Теперь к этой версии всегда можно вернуться.\n\nНе работает? Опишите агенту, что видите, и повторите цикл. К следующей задаче — только после проверки.',
    '5-QADAM · BIRINCHI SIKL: VAZIFA → TEKSHIRUV → SAQLASH\n1. **Vazifa beramiz** — bittasini, TASKS.md dan.\n2. **Agent bajaradi** — PRD.md ni oʻqiydi va kod yozadi. Agent ishlayotganda kutishni oʻtkazib yuborish mumkin.\n3. **Oʻzimiz tekshiramiz** — foydalanuvchi qanday qilsa, shunday ochib sinab koʻramiz.\n4. **Saqlaymiz** — GitHubga commit va TASKS.md da belgi. Endi bu versiyaga doim qaytish mumkin.\n\nIshlamayaptimi? Agentga nimani koʻrayotganingizni yozing va siklni takrorlang. Keyingi vazifaga — faqat tekshiruvdan keyin.',
  ),
  t(
    'ПРОМПТ · задача для агента\nПрочитай docs/PRD.md и docs/TASKS.md. Сделай только задачу 1: форма «Новая заявка» с полями имя, телефон, источник. Ничего сверх этого. Когда закончишь — объясни простыми словами, как мне проверить результат, и отметь задачу в TASKS.md.',
    'PROMPT · agent uchun vazifa\ndocs/PRD.md va docs/TASKS.md ni oʻqi. Faqat 1-vazifani bajar: ism, telefon, manba maydonlari bilan «Yangi ariza» shakli. Bundan ortiq hech narsa qilma. Tugatgach — natijani qanday tekshirishimni oddiy soʻzlar bilan tushuntir va vazifani TASKS.md da belgila.',
  ),
  t(
    'ПРОМПТ · если что-то не так\nЯ открыл форму и вижу: [опишите, что происходит]. Ожидал: [что должно быть]. Исправь только это, ничего другого не меняй.\n\nПРОМПТ · фиксация\nСделай commit с понятным сообщением на русском: что изменилось для пользователя. Отправь его в GitHub.',
    'PROMPT · biror narsa notoʻgʻri boʻlsa\nShaklni ochdim va koʻryapman: [nima boʻlayotganini yozing]. Kutgandim: [qanday boʻlishi kerak]. Faqat shuni tuzat, boshqa hech narsani oʻzgartirma.\n\nPROMPT · saqlash\nFoydalanuvchi uchun nima oʻzgarganini tushunarli yozib commit qil. Uni GitHubga yubor.',
  ),
  ask(
    'Упражнение 5.1 · Ваш промпт для первой задачи — вставьте целиком',
    '5.1-mashq · Birinchi vazifa uchun promptingiz — toʻliq qoʻying',
  ),
  pick('Упражнение 5.2 · Результат первого цикла', '5.2-mashq · Birinchi sikl natijasi', [
    opt('Работает с первого раза', 'Birinchi urinishda ishladi'),
    opt('Заработало после исправления', 'Tuzatishdan keyin ishladi'),
    opt('Пока не работает — нужна помощь', 'Hozircha ishlamayapti — yordam kerak'),
  ]),
  ask(
    'Упражнение 5.3 · Ссылка на ваш первый commit или текст его сообщения',
    '5.3-mashq · Birinchi commitingiz havolasi yoki uning xabari matni',
    'task',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 6 · ТИПИЧНЫЕ ОШИБКИ
  // ═══════════════════════════════════════════════════════════════════
  img('step-6.png', 'Шаг 6 · Типичные ошибки · 6-qadam · Koʻp uchraydigan xatolar'),
  t(
    'ШАГ 6 · ТИПИЧНЫЕ ОШИБКИ ВАЙБКОДЕРА — И КАК ИХ ИЗБЕЖАТЬ\n• **Всё сразу одним промптом** → делите на задачи из TASKS.md.\n• **Нет PRD — агент додумывает** → начинайте каждую задачу с «Прочитай docs/PRD.md».\n• **Не проверил — уже следующая задача** → сначала проверка, потом новая задача.\n• **Нет коммитов** → commit после каждой рабочей задачи, тогда всегда можно откатиться.\n• **Ключи и пароли в чате с ИИ** → никогда; секреты хранятся отдельно, данные пациентов — тоже.\n• **«Сделай красиво»** → пишите проверяемо: «кнопка зелёная, текст 18px, статус меняется в один клик».',
    '6-QADAM · VAYB-KODERNING KOʻP UCHRAYDIGAN XATOLARI — VA ULARDAN QANDAY QOCHISH\n• **Hammasini bitta promptda** → TASKS.md dagi vazifalarga boʻling.\n• **PRD yoʻq — agent oʻzicha toʻqiydi** → har bir vazifani «docs/PRD.md ni oʻqi» bilan boshlang.\n• **Tekshirmay — keyingi vazifaga** → avval tekshiruv, keyin yangi vazifa.\n• **Commit yoʻq** → har bir ishlaydigan vazifadan keyin commit, shunda doim orqaga qaytish mumkin.\n• **Kalit va parollar SI chatida** → hech qachon; sirlar alohida saqlanadi, bemorlar maʼlumotlari ham.\n• **«Chiroyli qil»** → tekshiriladigan qilib yozing: «tugma yashil, matn 18px, holat bir bosishda oʻzgaradi».',
  ),
  quiz(
    'Проверка · Агент сделал задачу. Что делаем дальше?',
    'Tekshiruv · Agent vazifani bajardi. Keyin nima qilamiz?',
    [
      opt('Сразу даём следующую задачу', 'Darhol keyingi vazifani beramiz'),
      opt('Проверяем сами и делаем commit', 'Oʻzimiz tekshiramiz va commit qilamiz'),
      opt('Просим переписать всё заново', 'Hammasini qaytadan yozishni soʻraymiz'),
    ],
    1,
  ),
  quiz(
    'Проверка · Что можно вставлять в чат с ИИ?',
    'Tekshiruv · SI chatiga nimani qoʻyish mumkin?',
    [
      opt('Пароль от 1С, чтобы агент подключился', 'Agent ulanishi uchun 1C paroli'),
      opt('Выгрузку с данными пациентов', 'Bemorlar maʼlumotlari bilan eksport'),
      opt('Текст PRD.md и описание ошибки', 'PRD.md matni va xato tavsifi'),
    ],
    2,
  ),
  ask(
    'Упражнение 6.1 · Какую ошибку вы уже совершали или боитесь совершить — и как её избежите?',
    '6.1-mashq · Qaysi xatoni allaqachon qilgansiz yoki qilishdan qoʻrqasiz — va undan qanday qochasiz?',
    'reflection',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 7 · ИТОГОВЫЙ ЧЕКЛИСТ + ЗАДАЧА НЕДЕЛИ
  // ═══════════════════════════════════════════════════════════════════
  img('step-7.png', 'Шаг 7 · Итоговый чеклист · 7-qadam · Yakuniy chek-list'),
  checklist('Шаг 7 · Итоговый чеклист — отметьте всё, что готово', '7-qadam · Yakuniy chek-list — tayyorlarini belgilang', [
    opt('Идея на одной странице: пользователь, проблема, метрика', 'Bir sahifalik gʻoya: foydalanuvchi, muammo, oʻlchov'),
    opt('PRD.md: MVP, что не делаем, критерии приёмки', 'PRD.md: MVP, nima qilmaymiz, qabul mezonlari'),
    opt('Репозиторий в GitHub с папкой docs/', 'docs/ papkali GitHub repozitoriysi'),
    opt('TASKS.md: задачи, каждая проверяется за 5 минут', 'TASKS.md: har biri 5 daqiqada tekshiriladigan vazifalar'),
    opt('Первая задача сделана, проверена и закоммичена', 'Birinchi vazifa bajarildi, tekshirildi va commit qilindi'),
    opt('Ключей и личных данных нет ни в коде, ни в чате', 'Kalit va shaxsiy maʼlumotlar kodda ham, chatda ham yoʻq'),
  ]),
  t(
    'ЗАДАЧА НЕДЕЛИ\nДоведите свой мини-проект до конца шага 5: идея, PRD.md, репозиторий с docs/, TASKS.md и хотя бы одна задача, сделанная агентом, проверенная и закоммиченная. Пригласите тренера в репозиторий и загрузите PRD.md ниже. Тренер проверит и даст обратную связь в LMS.',
    'HAFTA VAZIFASI\nMini-loyihangizni 5-qadam oxirigacha yetkazing: gʻoya, PRD.md, docs/ papkali repozitoriy, TASKS.md va agent bajargan, tekshirilgan va commit qilingan kamida bitta vazifa. Trenerni repozitoriyga taklif qiling va quyida PRD.md ni yuklang. Trener tekshiradi va LMS da fikr-mulohaza beradi.',
    'task',
  ),
  fileAsk(
    'Загрузите ваш PRD.md (или PDF/DOCX)',
    'PRD.md faylingizni yuklang (yoki PDF/DOCX)',
  ),
  rate(
    'Насколько понятно, как построить свой мини-проект? (1 — непонятно, 5 — всё ясно)',
    'Oʻz mini-loyihangizni qanday qurish qanchalik tushunarli? (1 — tushunarsiz, 5 — hammasi aniq)',
  ),
];

export const ORZU_WEEK1_STATS = {
  total: ORZU_WEEK1_WORKBOOK.length,
  images: ORZU_WEEK1_WORKBOOK.filter((b) => b.type === 'image').length,
  inputs: ORZU_WEEK1_WORKBOOK.filter((b) =>
    ['input_text', 'input_select', 'input_rating', 'input_file', 'test', 'checklist'].includes(
      b.type,
    ),
  ).length,
  tasks: ORZU_WEEK1_WORKBOOK.filter((b) => b.blockRole === 'task').length,
  breaks: 0,
};
