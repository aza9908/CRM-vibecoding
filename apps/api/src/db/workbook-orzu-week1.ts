/**
 * ORZU MEDICAL × AIRL · VibeOps · Неделя 1 «План» (airl-spec).
 *
 * Built from the programme PDF «VibeOps. Хаб руководителя. Программа AIRL»
 * (ноябрь 2026) and the Tilmoch slide from the Orzu Medical deck.
 * Every block is bilingual: Russian first, Uzbek (Latin script) below.
 *
 * Images are static assets in `apps/web/public/workbook/orzu/`:
 *   program-1..5.png  — pages of the programme PDF
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
  // СТАРТ · перевод и правила
  // ═══════════════════════════════════════════════════════════════════
  t(
    'ORZU MEDICAL × AIRL · VIBEOPS · НЕДЕЛЯ 1\nПлан: карта компании и ТЗ сервиса вашего отдела\n\nЗа 4 недели онлайн команды отделов создают свои боевые сервисы на данных компании, а скиллы AIRL собирают их в единый хаб руководителя. Блок 0 вы уже прошли. Сегодня — первый спринт: **план**. Главный скилл недели — **airl-spec**.',
    'ORZU MEDICAL × AIRL · VIBEOPS · 1-HAFTA\nReja: kompaniya xaritasi va boʻlimingiz servisi uchun texnik topshiriq (TZ)\n\n4 hafta davomida onlayn tarzda boʻlim jamoalari kompaniya maʼlumotlari asosida oʻz ishchi servislarini yaratadi, AIRL skillari esa ularni rahbarning yagona xabiga yigʻadi. 0-blokni siz allaqachon oʻtgansiz. Bugun — birinchi sprint: **reja**. Haftaning asosiy skilli — **airl-spec**.',
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
    'ПРАВИЛА ОНЛАЙН-УРОКА\n1. Видеосвязь — в панели **«Видеосвязь»** вверху страницы. Нажмите «Подключиться», микрофон держите выключенным, пока не дали слово.\n2. Вопрос — откройте вкладку **«Вопросы»** справа (на телефоне — ниже), задайте вопрос и голосуйте ▲ за вопросы коллег. Хотите сказать голосом — поднимите руку ✋.\n3. Ответы на упражнения пишите прямо здесь и нажимайте «Отправить» — сданный блок отмечается **«Сдано ✓»**, а тренер видит ответ сразу.\n4. Тренер подсвечивает блок, на котором мы сейчас, — кнопка «К текущему блоку» вернёт вас к нему.',
    'ONLAYN DARS QOIDALARI\n1. Videoaloqa — sahifa tepasidagi **«Videoaloqa»** panelida. «Ulanish» tugmasini bosing, soʻz berilmaguncha mikrofonni oʻchiq tuting.\n2. Savol — oʻngdagi **«Savollar»** boʻlimini oching (telefonda — pastda), savol bering va hamkasblar savollariga ▲ ovoz bering. Ovozli gapirmoqchi boʻlsangiz — qoʻl koʻtaring ✋.\n3. Mashqlarga javoblarni shu yerda yozing va «Yuborish»ni bosing — topshirilgan blok **«Topshirildi ✓»** deb belgilanadi, trener javobni darhol koʻradi.\n4. Trener hozir turgan blokimizni belgilaydi — «Joriy blokka» tugmasi sizni unga qaytaradi.',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ЧТО СТРОИМ · программа курса
  // ═══════════════════════════════════════════════════════════════════
  t(
    'ЧТО МЫ СТРОИМ ЗА 4 НЕДЕЛИ\nДанные компании лежат в 1С, Bitrix24, amoCRM и таблицах. VibeOps собирает их в одно хранилище (airl-dwh), вокруг него каждый отдел строит свой сервис, а airl-hub объединяет сервисы в **хаб руководителя**: один вход, роли, единый дизайн.\n\n**4 спринта** — по одному в неделю, всё онлайн в LMS.\n**Свой сервис** — каждый отдел создаёт сервис под свою задачу.\n**1 хаб** — все отделы на одном экране руководителя.',
    '4 HAFTADA NIMA QURAMIZ\nKompaniya maʼlumotlari 1C, Bitrix24, amoCRM va jadvallarda turibdi. VibeOps ularni bitta omborga (airl-dwh) yigʻadi, uning atrofida har bir boʻlim oʻz servisini quradi, airl-hub esa servislarni **rahbar xabiga** birlashtiradi: bitta kirish, rollar, yagona dizayn.\n\n**4 sprint** — haftasiga bittadan, hammasi LMSda onlayn.\n**Oʻz servisingiz** — har bir boʻlim oʻz vazifasi uchun servis yaratadi.\n**1 xab** — barcha boʻlimlar rahbarning bitta ekranida.',
  ),
  img(
    'program-1.png',
    'VibeOps · Данные компании в центре, отделы вокруг · Kompaniya maʼlumotlari markazda, boʻlimlar atrofida',
  ),
  t(
    'КАК УСТРОЕН КУРС\n**Неделя 1 · План** — airl-spec: ТЗ сервиса по карте компании.\n**Неделя 2 · Данные** — airl-dwh, airl-pwa: хранилище, витрина отдела, PWA.\n**Неделя 3 · Защита** — airl-cybersecurity: вход и роли, ключи, чек-лист.\n**Неделя 4 · Запуск** — airl-vps, airl-launch, airl-code-review-2.0, airl-hub: сервер, домен, код-ревью, сервис в хабе.\n**Финал · Demo Day** — каждый отдел показывает свой боевой продукт в хабе.',
    'KURS QANDAY TUZILGAN\n**1-hafta · Reja** — airl-spec: kompaniya xaritasi boʻyicha servis TZsi.\n**2-hafta · Maʼlumotlar** — airl-dwh, airl-pwa: ombor, boʻlim vitrinasi, PWA.\n**3-hafta · Himoya** — airl-cybersecurity: kirish va rollar, kalitlar, chek-list.\n**4-hafta · Ishga tushirish** — airl-vps, airl-launch, airl-code-review-2.0, airl-hub: server, domen, kod-review, servis xabda.\n**Final · Demo Day** — har bir boʻlim oʻzining ishchi mahsulotini xabda koʻrsatadi.',
  ),
  img(
    'program-3.png',
    'Как устроен курс и программа по неделям · Kurs tuzilishi va haftalik dastur',
  ),
  t(
    'КАК ПРОХОДИТ ОДНА НЕДЕЛЯ\n**Урок · 1,5 часа** — разбор прогресса (20 мин), видео-демонстрация (20 мин), Q&A (50 мин).\n**В течение недели** — упражнения в LMS и задача спринта в сервисе своего отдела.\n**Конец недели** — тренер проверяет упражнения и задачи в LMS и даёт обратную связь.\n\nВсю неделю тренер отвечает на вопросы в чате курса, а менеджер курса следит, чтобы ни один отдел не отставал.',
    'BIR HAFTA QANDAY OʻTADI\n**Dars · 1,5 soat** — progress tahlili (20 daq), video-namoyish (20 daq), savol-javob (50 daq).\n**Hafta davomida** — LMSdagi mashqlar va oʻz boʻlimingiz servisidagi sprint vazifasi.\n**Hafta oxiri** — trener LMSda mashqlar va vazifalarni tekshiradi va fikr-mulohaza beradi.\n\nButun hafta trener kurs chatida savollarga javob beradi, kurs menejeri esa hech bir boʻlim ortda qolmasligini kuzatadi.',
  ),
  img(
    'program-4.png',
    'Как проходит одна неделя и урок по минутам · Bir hafta va dars daqiqalar boʻyicha',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // 0–20 · РАЗБОР ПРОГРЕССА
  // ═══════════════════════════════════════════════════════════════════
  t(
    'БЛОК 1 · РАЗБОР ПРОГРЕССА · 0–20 МИН\nКоманды отделов коротко показывают, что сделано после Блока 0 и где застряли. Ответьте на три вопроса ниже — тренер видит ответы всей группы.',
    '1-BLOK · PROGRESS TAHLILI · 0–20 DAQ\nBoʻlim jamoalari 0-blokdan keyin nima qilinganini va qayerda qiyinchilik boʻlganini qisqacha koʻrsatadi. Quyidagi uchta savolga javob bering — trener butun guruh javoblarini koʻradi.',
  ),
  pick('Ваш отдел', 'Boʻlimingiz', [
    opt('Регистратура и приём пациентов', 'Registratura va bemorlarni qabul qilish'),
    opt('Маркетинг', 'Marketing'),
    opt('Продажи и call-центр', 'Sotuv va call-markaz'),
    opt('HR', 'Kadrlar boʻlimi'),
    opt('Финансы и бухгалтерия', 'Moliya va buxgalteriya'),
    opt('Медицинский отдел', 'Tibbiyot boʻlimi'),
    opt('Руководство', 'Rahbariyat'),
    opt('Другое', 'Boshqa'),
  ]),
  pick(
    'Скиллы AIRL из Блока 0 установлены и работают',
    '0-blokdagi AIRL skillari oʻrnatilgan va ishlayapti',
    [opt('Да', 'Ha'), opt('Частично', 'Qisman'), opt('Нет', 'Yoʻq')],
  ),
  ask(
    'Что вы сделали после Блока 0 и где застряли?',
    '0-blokdan keyin nima qildingiz va qayerda qiyinchilikka duch keldingiz?',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // 20–40 · ВИДЕО-ДЕМОНСТРАЦИЯ · airl-spec
  // ═══════════════════════════════════════════════════════════════════
  t(
    'БЛОК 2 · ВИДЕО-ДЕМОНСТРАЦИЯ · 20–40 МИН\nairl-spec: карта компании и ТЗ для каждого отдела\n\nВсё начинается с **карты компании** — одного общего ТЗ, которое составляет airl-spec. В карте:\n• системы и данные компании (1С, Bitrix24, amoCRM, таблицы);\n• отделы и их сервисы;\n• единые показатели;\n• роли и доступы;\n• правила подключения к хабу.\n\nПо карте строится хранилище, а ТЗ сервиса каждого отдела пишется как её **ветка** — поэтому сервисы с первого дня совместимы. В видео задача недели решается шаг за шагом с airl-spec.',
    '2-BLOK · VIDEO-NAMOYISH · 20–40 DAQ\nairl-spec: kompaniya xaritasi va har bir boʻlim uchun TZ\n\nHammasi **kompaniya xaritasidan** boshlanadi — airl-spec tuzadigan bitta umumiy TZ. Xaritada:\n• kompaniya tizimlari va maʼlumotlari (1C, Bitrix24, amoCRM, jadvallar);\n• boʻlimlar va ularning servislari;\n• yagona koʻrsatkichlar;\n• rollar va kirish huquqlari;\n• xabga ulanish qoidalari.\n\nXarita asosida ombor quriladi, har bir boʻlim servisining TZsi esa uning **shoxchasi** sifatida yoziladi — shuning uchun servislar birinchi kundan mos keladi. Videoda haftaning vazifasi airl-spec bilan qadamma-qadam yechiladi.',
  ),
  img(
    'program-2.png',
    'airl-spec: карта компании и ТЗ для каждого отдела · airl-spec: kompaniya xaritasi va har bir boʻlim uchun TZ',
  ),
  t(
    'ТЗ СЕРВИСА ОТДЕЛА — 6 ВОПРОСОВ\n**Какие данные берёт** — общие данные из хранилища и витрину своего отдела.\n**Какие показатели считает** — по единым определениям из карты компании.\n**Что отдаёт в хаб** — показатели отдела для экрана руководителя.\n**Кто видит** — роли сотрудников отдела и руководителя.\n**С кем связан** — какие данные других отделов использует и как.\n**Когда готово** — критерии, по которым сервис принимают в хаб.',
    'BOʻLIM SERVISI TZSI — 6 SAVOL\n**Qanday maʼlumot oladi** — ombordagi umumiy maʼlumotlar va oʻz boʻlimi vitrinasi.\n**Qanday koʻrsatkichlarni hisoblaydi** — kompaniya xaritasidagi yagona taʼriflar boʻyicha.\n**Xabga nimani beradi** — rahbar ekrani uchun boʻlim koʻrsatkichlari.\n**Kim koʻradi** — boʻlim xodimlari va rahbarning rollari.\n**Kim bilan bogʻliq** — boshqa boʻlimlarning qaysi maʼlumotlaridan va qanday foydalanadi.\n**Qachon tayyor** — servis xabga qabul qilinadigan mezonlar.',
  ),
  quiz(
    'Почему ТЗ сервиса отдела пишется как ветка карты компании?',
    'Nega boʻlim servisi TZsi kompaniya xaritasining shoxchasi sifatida yoziladi?',
    [
      opt('Так быстрее печатать', 'Shunday yozish tezroq'),
      opt(
        'Чтобы сервисы всех отделов с первого дня были совместимы: одни данные, одни показатели, одни правила хаба',
        'Barcha boʻlimlar servislari birinchi kundan mos boʻlishi uchun: bir xil maʼlumotlar, bir xil koʻrsatkichlar, xabning bir xil qoidalari',
      ),
      opt(
        'Чтобы каждый отдел сам выбрал свою базу данных',
        'Har bir boʻlim oʻz maʼlumotlar bazasini oʻzi tanlashi uchun',
      ),
    ],
    1,
  ),
  quiz(
    'Куда сервис отдела записывает свои данные?',
    'Boʻlim servisi oʻz maʼlumotlarini qayerga yozadi?',
    [
      opt('Напрямую в 1С', 'Toʻgʻridan-toʻgʻri 1Cga'),
      opt('Только в витрину своего отдела в хранилище', 'Faqat ombordagi oʻz boʻlimi vitrinasiga'),
      opt('В любую таблицу хранилища', 'Omborning istalgan jadvaliga'),
    ],
    1,
  ),
  quiz(
    'Кто видит показатели всех отделов?',
    'Barcha boʻlimlar koʻrsatkichlarini kim koʻradi?',
    [
      opt('Каждый сотрудник клиники', 'Klinikaning har bir xodimi'),
      opt('Руководитель — в хабе', 'Rahbar — xabda'),
      opt('Только IT-отдел', 'Faqat IT boʻlimi'),
    ],
    1,
  ),

  // ═══════════════════════════════════════════════════════════════════
  // 40–90 · Q&A
  // ═══════════════════════════════════════════════════════════════════
  t(
    'БЛОК 3 · Q&A · 40–90 МИН\nОтветы на вопросы и помощь с задачами отделов.\n1. Задайте вопрос во вкладке **«Вопросы»** — самые нужные вопросы поднимаются голосами ▲.\n2. Тренер нажимает «Дать слово» — у вас появится подсказка включить микрофон в видеосвязи.\n3. Отвеченные вопросы остаются в списке «Отвечено» — их можно перечитать.\nВ конце у каждого зафиксирована задача спринта.',
    '3-BLOK · SAVOL-JAVOB · 40–90 DAQ\nSavollarga javoblar va boʻlimlar vazifalari boʻyicha yordam.\n1. **«Savollar»** boʻlimida savol bering — eng kerakli savollar ▲ ovozlar bilan yuqoriga koʻtariladi.\n2. Trener «Soʻz berish»ni bosadi — sizda videoaloqada mikrofonni yoqish haqida eslatma chiqadi.\n3. Javob berilgan savollar «Javob berilgan» roʻyxatida qoladi — ularni qayta oʻqish mumkin.\nOxirida har kimning sprint vazifasi belgilab olinadi.',
  ),
  ask(
    'Ваша задача спринта на эту неделю — одной фразой (зафиксируйте в конце Q&A)',
    'Bu haftalik sprint vazifangiz — bitta jumlada (savol-javob oxirida belgilang)',
    'task',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // УПРАЖНЕНИЯ · черновик ТЗ своего отдела
  // ═══════════════════════════════════════════════════════════════════
  t(
    'УПРАЖНЕНИЯ НЕДЕЛИ · ЧЕРНОВИК ТЗ ВАШЕГО ОТДЕЛА\n8 коротких ответов, каждый сдаётся кнопкой «Отправить» и отмечается «Сдано ✓». Можно начать на уроке и закончить в течение недели. Ответьте коротко, своими словами — это черновик, из которого airl-spec соберёт ТЗ. Пример для регистратуры: «Сервис показывает загрузку врачей и неявки пациентов по дням».',
    'HAFTA MASHQLARI · BOʻLIMINGIZ TZSINING QORALAMASI\n8 ta qisqa javob, har biri «Yuborish» tugmasi bilan topshiriladi va «Topshirildi ✓» deb belgilanadi. Darsda boshlab, hafta davomida tugatish mumkin. Qisqa, oʻz soʻzlaringiz bilan javob bering — bu qoralama, undan airl-spec TZ yigʻadi. Registratura uchun misol: «Servis shifokorlar bandligini va bemorlarning kelmay qolishini kunlar boʻyicha koʻrsatadi».',
  ),
  ask(
    'Задача сервиса вашего отдела — одной фразой',
    'Boʻlimingiz servisining vazifasi — bitta jumlada',
  ),
  ask(
    'Где сейчас лежат данные вашего отдела? (1С, Bitrix24, amoCRM, Excel, бумага…)',
    'Hozir boʻlimingiz maʼlumotlari qayerda? (1C, Bitrix24, amoCRM, Excel, qogʻoz…)',
  ),
  ask('1. Какие данные берёт сервис?', '1. Servis qanday maʼlumotlarni oladi?'),
  ask(
    '2. Какие показатели считает? (например: записи за день, неявки, выручка по услугам)',
    '2. Qanday koʻrsatkichlarni hisoblaydi? (masalan: kunlik yozilishlar, kelmay qolganlar, xizmatlar boʻyicha tushum)',
  ),
  ask(
    '3. Что сервис отдаёт в хаб руководителя?',
    '3. Servis rahbar xabiga nimani beradi?',
  ),
  ask(
    '4. Кто видит сервис? Какие роли и что видит каждая?',
    '4. Servisni kim koʻradi? Qanday rollar bor va har biri nimani koʻradi?',
  ),
  ask(
    '5. С какими отделами связан и какие их данные использует?',
    '5. Qaysi boʻlimlar bilan bogʻliq va ularning qaysi maʼlumotlaridan foydalanadi?',
  ),
  ask(
    '6. Когда сервис готов? 2–3 критерия приёмки в хаб',
    '6. Servis qachon tayyor? Xabga qabul qilishning 2–3 mezoni',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ЗАДАЧА СПРИНТА · неделя 1
  // ═══════════════════════════════════════════════════════════════════
  t(
    'ЗАДАЧА СПРИНТА · НЕДЕЛЯ 1\nС помощью **airl-spec** напишите ТЗ сервиса своего отдела как ветку карты компании и сохраните его в репозитории GitHub.\n\nСрок — конец недели. Тренер проверяет задачу в LMS и даёт обратную связь.\n**Результат для компании:** сервисы всех отделов спланированы по единым правилам.',
    'SPRINT VAZIFASI · 1-HAFTA\n**airl-spec** yordamida boʻlimingiz servisi TZsini kompaniya xaritasining shoxchasi sifatida yozing va uni GitHub repozitoriysida saqlang.\n\nMuddat — hafta oxiri. Trener vazifani LMSda tekshiradi va fikr-mulohaza beradi.\n**Kompaniya uchun natija:** barcha boʻlimlar servislari yagona qoidalar asosida rejalashtirilgan.',
    'task',
  ),
  ask(
    'Ссылка на репозиторий с ТЗ',
    'TZ joylashgan repozitoriy havolasi',
    'task',
  ),
  fileAsk(
    'Загрузите файл ТЗ (PDF, DOCX или MD)',
    'TZ faylini yuklang (PDF, DOCX yoki MD)',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ПРОВЕРКА В LMS · чек-лист сдачи
  // ═══════════════════════════════════════════════════════════════════
  t(
    'ПРОВЕРКА В LMS · КОНЕЦ НЕДЕЛИ\nОтметьте, что всё сдано. Тренер проверяет упражнения и задачу спринта в LMS и даёт обратную связь — прогресс вашего отдела виден руководителю.',
    'LMSDA TEKSHIRUV · HAFTA OXIRI\nHammasi topshirilganini belgilang. Trener LMSda mashqlar va sprint vazifasini tekshiradi va fikr-mulohaza beradi — boʻlimingiz progressi rahbarga koʻrinadi.',
    'task',
  ),
  checklist('Чек-лист сдачи недели 1', 'Hafta 1 topshiriqlari chek-listi', [
    opt('Ответил(а) на вопросы разбора прогресса', 'Progress tahlili savollariga javob berdim'),
    opt('Прошёл(а) 3 вопроса на проверку', '3 ta tekshiruv savolidan oʻtdim'),
    opt('Сдал(а) 8 упражнений — черновик ТЗ', '8 ta mashqni topshirdim — TZ qoralamasi'),
    opt('ТЗ написано через airl-spec и сохранено в GitHub', 'TZ airl-spec orqali yozildi va GitHubda saqlandi'),
    opt('Отправил(а) ссылку на репозиторий и файл ТЗ', 'Repozitoriy havolasi va TZ faylini yubordim'),
  ]),

  // ═══════════════════════════════════════════════════════════════════
  // ИТОГ
  // ═══════════════════════════════════════════════════════════════════
  rate(
    'Насколько понятно, что делать на этой неделе? (1 — непонятно, 5 — всё ясно)',
    'Bu hafta nima qilish kerakligi qanchalik tushunarli? (1 — tushunarsiz, 5 — hammasi aniq)',
  ),
  t(
    'ДАЛЬШЕ · НЕДЕЛЯ 2 · ДАННЫЕ\nПодключаем сервис к данным компании через **airl-dwh** и собираем его как PWA через **airl-pwa** — сервисы начинают работать на реальных данных из 1С и CRM.\n\nФинал курса — **Demo Day**: каждый отдел показывает руководителю свой боевой сервис, уже собранный в одном хабе.',
    'KEYINGI · 2-HAFTA · MAʼLUMOTLAR\nServisni **airl-dwh** orqali kompaniya maʼlumotlariga ulaymiz va **airl-pwa** orqali PWA sifatida yigʻamiz — servislar 1C va CRMdagi haqiqiy maʼlumotlar bilan ishlay boshlaydi.\n\nKurs finali — **Demo Day**: har bir boʻlim rahbarga bitta xabga yigʻilgan oʻz ishchi servisini koʻrsatadi.',
  ),
  img(
    'program-5.png',
    'Demo Day и команда курса · Demo Day va kurs jamoasi',
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
