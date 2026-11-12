/**
 * ORZU MEDICAL × AIRL · Урок 1 «Строим мини-проект с ИИ за 7 шагов».
 *
 * Example project: a clinic request tracker. Each step = slide + goal / how /
 * result + the real prompts and files (IDEA.md, SPEC.md from /airl-spec,
 * TASKS.md) + exercises. Every block is bilingual: Russian first, Uzbek
 * (Latin script) below.
 *
 * Images are static assets in `apps/web/public/workbook/orzu/`:
 *   step-0..7.png     — lesson slides (AIRL style, RU + UZ, 1600×900)
 *   team.png          — «Кто ведёт урок» (trainers)
 *   support.png       — «4 недели сопровождения»: format, skills workflow, 4-week plan
 *   goals.png         — «Завтра на уроке»: 90-minute plan and results
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
  // СТАРТ · о чём урок, карта урока, перевод, правила
  // ═══════════════════════════════════════════════════════════════════
  t(
    'ORZU MEDICAL × AIRL · УРОК 1\nСтроим мини-проект с ИИ за 7 шагов\n\nНа простом примере — **трекере заявок клиники** — пройдём весь путь: от идеи на одной странице до первой задачи, которую сделает ИИ-агент. Программировать уметь не нужно: показываем настоящие промпты и файлы, вы повторяете их в своём проекте.\n\n**Главный инструмент урока — навык /airl-spec:** он превращает вашу задачу в настоящий PRD (файл SPEC.md), по которому дальше работает агент.',
    'ORZU MEDICAL × AIRL · 1-DARS\nSunʼiy intellekt bilan mini-loyiha — 7 qadamda\n\nOddiy misolda — **klinika arizalari trekeri** — butun yoʻlni bosib oʻtamiz: bir sahifalik gʻoyadan SI-agent bajaradigan birinchi vazifagacha. Dasturlashni bilish shart emas: haqiqiy promptlar va fayllarni koʻrsatamiz, siz ularni oʻz loyihangizda takrorlaysiz.\n\n**Darsning asosiy vositasi — /airl-spec koʻnikmasi:** u vazifangizni haqiqiy PRD ga (SPEC.md fayli) aylantiradi, keyin agent shu fayl boʻyicha ishlaydi.',
    'agenda',
  ),
  img('support.png', '4 недели сопровождения: как мы работаем и как работать со скиллами · 4 haftalik hamrohlik'),
  img('team.png', 'Кто ведёт урок: Жанибек Серкулов, Азамат Арманулы · Darsni kim olib boradi'),
  img('goals.png', 'Завтра на уроке: план на 90 минут и результаты · Darsda: 90 daqiqalik reja va natijalar'),
  t(
    'КАРТА УРОКА · что получится на каждом шаге\n1. **Идея на одну страницу** → docs/IDEA.md\n2. **Мини-PRD с /airl-spec** → SPEC.md и ARCHITECTURE.md\n3. **Подготовка проекта** → репозиторий GitHub, CLAUDE.md, папка docs/\n4. **План и маленькие задачи** → docs/TASKS.md\n5. **Первый цикл с агентом** → первая готовая функция и commit\n6. **Типичные ошибки** → как их не допустить\n7. **Итоговый чеклист** → всё ли готово к следующему уроку\n\n**Как сдавать упражнения:** напишите ответ и нажмите «Отправить». Выбор и оценка отправляются сразу при нажатии; в проверочных вопросах выберите вариант и нажмите «Проверить». Чеклист сдаётся, когда отмечены все пункты. Принятое упражнение отмечается зелёной галочкой **«Ответ принят»** — тренер видит ответ сразу.',
    'DARS XARITASI · har bir qadamda nima chiqadi\n1. **Bir sahifalik gʻoya** → docs/IDEA.md\n2. **/airl-spec bilan mini-PRD** → SPEC.md va ARCHITECTURE.md\n3. **Loyihani tayyorlash** → GitHub repozitoriysi, CLAUDE.md, docs/ papkasi\n4. **Reja va kichik vazifalar** → docs/TASKS.md\n5. **Agent bilan birinchi sikl** → birinchi tayyor funksiya va commit\n6. **Koʻp uchraydigan xatolar** → ulardan qanday qochish\n7. **Yakuniy chek-list** → keyingi darsga hammasi tayyormi\n\n**Mashqlarni qanday topshirish:** javob yozing va «Yuborish»ni bosing. Tanlov va baho bosilganda darhol yuboriladi; tekshiruv savollarida variantni tanlab «Tekshirish»ni bosing. Chek-list barcha bandlar belgilanganda topshiriladi. Qabul qilingan mashq yashil belgi **«Javob qabul qilindi»** bilan belgilanadi — trener javobni darhol koʻradi.',
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
    'КАК ПРОХОДИТ УРОК\n1. **Видеосвязь** подключается автоматически, когда её запускает преподаватель. Микрофон и камера выключены — включите, когда дадут слово. При прокрутке видео остаётся в углу экрана.\n2. **Вопросы** — во вкладке «Вопросы»: задайте свой и поддержите ▲ вопросы коллег.\n3. **Безопасность:** никогда не вставляйте в чат с ИИ пароли, ключи и данные пациентов.',
    'DARS QANDAY OʻTADI\n1. **Videoaloqa** oʻqituvchi boshlaganda avtomatik ulanadi. Mikrofon va kamera oʻchiq — soʻz berilganda yoqing. Sahifani aylantirganda video ekran burchagida qoladi.\n2. **Savollar** — «Savollar» boʻlimida: oʻz savolingizni bering va hamkasblar savollariga ▲ ovoz bering.\n3. **Xavfsizlik:** SI chatiga hech qachon parollar, kalitlar va bemorlar maʼlumotlarini qoʻymang.',
  ),
  img('step-0.png', 'Строим мини-проект с ИИ — 7 шагов · Sunʼiy intellekt bilan mini-loyiha — 7 qadam'),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 1 · ИДЕЯ НА ОДНУ СТРАНИЦУ
  // ═══════════════════════════════════════════════════════════════════
  img('step-1.png', 'Шаг 1 · Идея на одну страницу · 1-qadam · Bir sahifalik gʻoya'),
  t(
    'ШАГ 1 · ИДЕЯ НА ОДНУ СТРАНИЦУ\n**Цель:** понять, что именно мы строим и зачем, — до того как просить ИИ что-то делать.\n**Как:** отвечаем на три вопроса — **пользователь** (конкретная роль, а не «все»), **проблема** (что сейчас теряется или делается руками), **метрика успеха** (по какой цифре поймём, что стало лучше).\n**Результат шага:** файл docs/IDEA.md — не больше 15 строк. Не помещается на страницу — идея слишком большая для первого проекта, урежьте её.\n\nЭти же ответы понадобятся на шаге 2: /airl-spec начинает именно с них.',
    '1-QADAM · BIR SAHIFALIK GʻOYA\n**Maqsad:** SI dan biror narsa soʻrashdan oldin aynan nima va nima uchun qurayotganimizni tushunish.\n**Qanday:** uchta savolga javob beramiz — **foydalanuvchi** («hamma» emas, aniq rol), **muammo** (hozir nima yoʻqoladi yoki qoʻlda qilinadi), **muvaffaqiyat oʻlchovi** (yaxshilanganini qaysi raqam bilan bilamiz).\n**Qadam natijasi:** docs/IDEA.md fayli — 15 qatordan oshmasin. Sahifaga sigʻmasa — gʻoya birinchi loyiha uchun juda katta, uni qisqartiring.\n\nShu javoblar 2-qadamda kerak boʻladi: /airl-spec aynan ulardan boshlaydi.',
  ),
  t(
    'ПРОМПТ · копируйте в чат с Claude\nПомоги мне описать идею мини-проекта на одну страницу. Задавай мне вопросы по одному, пока не узнаешь: кто пользователь, какую проблему решаем и по какой метрике поймём, что стало лучше. Потом собери ответ в файл docs/IDEA.md: заголовок, три раздела, не больше 15 строк. Пиши простым языком, без технических терминов.',
    'PROMPT · Claude chatiga nusxalang\nMenga mini-loyiha gʻoyasini bir sahifada tasvirlashga yordam ber. Foydalanuvchi kimligini, qaysi muammoni hal qilishimizni va yaxshilanganini qaysi oʻlchov bilan bilishimizni aniqlamaguningcha savollarni bittadan ber. Keyin javobni docs/IDEA.md fayliga yigʻ: sarlavha, uchta boʻlim, 15 qatordan oshmasin. Oddiy tilda, texnik atamalarsiz yoz.',
  ),
  t(
    'ФАЙЛ · docs/IDEA.md — что получилось у нас\n# Трекер заявок клиники\nПользователь: администратор call-центра.\nПроблема: заявки приходят в WhatsApp, Instagram и по телефону, записываются в тетрадь и теряются.\nМетрика успеха: каждая заявка получает ответ за 15 минут; ни одна не потеряна.',
    'FAYL · docs/IDEA.md — bizda nima chiqdi\n# Klinika arizalari trekeri\nFoydalanuvchi: call-markaz administratori.\nMuammo: arizalar WhatsApp, Instagram va telefon orqali keladi, daftarga yoziladi va yoʻqoladi.\nMuvaffaqiyat oʻlchovi: har bir arizaga 15 daqiqada javob beriladi; birortasi ham yoʻqolmaydi.',
  ),
  ask(
    'Упражнение 1.1 · Кто пользователь вашего мини-проекта? Конкретная роль',
    '1.1-mashq · Mini-loyihangiz foydalanuvchisi kim? Aniq rol',
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
  // ШАГ 2 · МИНИ-PRD С /airl-spec
  // ═══════════════════════════════════════════════════════════════════
  img('step-2.png', 'Шаг 2 · Мини-PRD с /airl-spec · 2-qadam · /airl-spec bilan mini-PRD'),
  t(
    'ШАГ 2 · МИНИ-PRD С /airl-spec\n**Цель:** получить настоящий PRD — документ, по которому продукт собирают в IT-командах. В AIRL он называется **SPEC.md**.\n**Как:** запускаем навык /airl-spec и отвечаем на его вопросы. Он ведёт разговор сам — нужно только честно отвечать.\n**Результат шага:** SPEC.md (PRD) и ARCHITECTURE.md (схема и технологии) в корне проекта.',
    '2-QADAM · /airl-spec BILAN MINI-PRD\n**Maqsad:** haqiqiy PRD olish — IT-jamoalarda mahsulot shu hujjat boʻyicha yigʻiladi. AIRL da u **SPEC.md** deb ataladi.\n**Qanday:** /airl-spec koʻnikmasini ishga tushiramiz va uning savollariga javob beramiz. U suhbatni oʻzi olib boradi — faqat halol javob berish kerak.\n**Qadam natijasi:** loyiha ildizida SPEC.md (PRD) va ARCHITECTURE.md (sxema va texnologiyalar).',
  ),
  t(
    'ЧЕМ /airl-spec ЛУЧШЕ, ЧЕМ «НАПИШИ МНЕ ТЗ»\n• **Начинает с боли и её цены в цифрах**, а не с экранов: «сейчас я делаю X, и это стоит Y». Эта цифра — ваше «было» для Demo Day.\n• **Вопросы по одному**, к каждому варианты A–D и рекомендация. Отвечать можно одной буквой; «не знаю» — он возьмёт рекомендацию и скажет об этом.\n• **Не принимает размытые ответы** вроде «чтобы было удобно» — переспросит на примере.\n• **Критерии готовности проверяемые** действием или числом: не «удобный интерфейс», а «заявка создаётся за 30 секунд».\n• **Ничего не решает молча:** всё, что выбрал за вас, выписывает в раздел «Решено по умолчанию».\n• **Знает про закон и данные:** факт обращения в клинику — это особые данные о здоровье, и он сразу скажет, что это значит для проекта.\n• **SPEC.md читают следующие навыки** (/airl-dwh, /airl-pwa и другие) — объяснять задачу заново не придётся.\n• **Код не пишет** — только документы. Код будет на шаге 5.',
    'NIMA UCHUN /airl-spec «MENGA TZ YOZ» DAN YAXSHIROQ\n• **Ekranlardan emas, muammo va uning raqamdagi narxidan boshlaydi:** «hozir men X qilaman va bu Y ga tushadi». Bu raqam — Demo Day uchun «oldin» holatingiz.\n• **Savollar bittadan**, har biriga A–D variantlar va tavsiya. Bitta harf bilan javob berish mumkin; «bilmayman» — u tavsiyani oladi va buni aytadi.\n• **«Qulay boʻlsin» kabi noaniq javoblarni qabul qilmaydi** — misol orqali qayta soʻraydi.\n• **Tayyorlik mezonlari tekshiriladigan** — harakat yoki raqam bilan: «qulay interfeys» emas, «ariza 30 soniyada yaratiladi».\n• **Hech narsani jimgina hal qilmaydi:** siz uchun tanlaganini «Standart boʻyicha hal qilindi» boʻlimiga yozadi.\n• **Qonun va maʼlumotlarni biladi:** klinikaga murojaat fakti — sogʻliq haqidagi maxsus maʼlumot, u buning loyiha uchun nimani anglatishini darhol aytadi.\n• **SPEC.md ni keyingi koʻnikmalar oʻqiydi** (/airl-dwh, /airl-pwa va boshqalar) — vazifani qayta tushuntirish kerak boʻlmaydi.\n• **Kod yozmaydi** — faqat hujjatlar. Kod 5-qadamda boʻladi.',
  ),
  t(
    'КАК ЗАПУСТИТЬ /airl-spec\n1. Откройте в VS Code пустую папку проекта (например, tracker-zayavok).\n2. В панели Claude наберите /airl — появится список навыков AIRL. Списка нет — навыки не установлены: выполните команды ниже в терминале VS Code и перезагрузите окно.\n3. Запустите навык одной строкой с идеей из шага 1.',
    '/airl-spec NI QANDAY ISHGA TUSHIRISH\n1. VS Code da loyihaning boʻsh papkasini oching (masalan, tracker-zayavok).\n2. Claude panelida /airl ni tering — AIRL koʻnikmalari roʻyxati chiqadi. Roʻyxat yoʻq — koʻnikmalar oʻrnatilmagan: quyidagi buyruqlarni VS Code terminalida bajaring va oynani qayta yuklang.\n3. Koʻnikmani 1-qadamdagi gʻoya bilan bitta qatorda ishga tushiring.',
  ),
  t(
    'ФАЙЛ · установка навыков AIRL (один раз, в терминале VS Code)\nclaude plugin marketplace add aza9908/airl-skills\nclaude plugin install airl@airl-skills',
    'FAYL · AIRL koʻnikmalarini oʻrnatish (bir marta, VS Code terminalida)\nclaude plugin marketplace add aza9908/airl-skills\nclaude plugin install airl@airl-skills',
  ),
  t(
    'ПРОМПТ · команда в панели Claude\n/airl:airl-spec трекер заявок клиники: администратор call-центра теряет заявки из WhatsApp и Instagram',
    'PROMPT · Claude panelidagi buyruq\n/airl:airl-spec klinika arizalari trekeri: call-markaz administratori WhatsApp va Instagramdan kelgan arizalarni yoʻqotadi',
  ),
  t(
    'ФАЙЛ · так /airl-spec задаёт вопрос (настоящий формат)\nВопрос 2 из 11. Сколько стоит эта боль сейчас?\nA) ~5 потерянных заявок в неделю — рекомендую\nB) ~2 часа в день на разбор переписок\nC) Не знаю — давайте замерим за одну неделю\nD) Свой вариант\nРекомендую A: потерянные заявки — это деньги, их легко показать на Demo Day как «было → стало».',
    'FAYL · /airl-spec savolni shunday beradi (haqiqiy format)\n2-savol, jami 11. Bu muammo hozir qanchaga tushadi?\nA) Haftasiga ~5 ta yoʻqolgan ariza — tavsiya qilaman\nB) Yozishmalarni koʻrib chiqishga kuniga ~2 soat\nC) Bilmayman — bir hafta davomida oʻlchaymiz\nD) Oʻz variantingiz\nA ni tavsiya qilaman: yoʻqolgan arizalar — bu pul, ularni Demo Day da «oldin → keyin» deb koʻrsatish oson.',
  ),
  t(
    'ФАЙЛ · SPEC.md — фрагмент того, что получилось у нас\n# SPEC · Трекер заявок клиники\nАвтор: Азамат, руководитель отдела, Сервис и качество\n## Боль и её цена\nЗаявки из WhatsApp, Instagram и звонков теряются: ~5 в неделю.\n## Кто пользуется\nАдминистраторы call-центра; руководитель — только просмотр.\n## Главное действие\nПринять заявку и назначить ответственного — в 2 касания.\n## Первая версия\nФорма заявки · список со статусами · ответственный.\n## Не делаем сейчас\nОплату, интеграцию с 1С, мобильное приложение, SMS.\n## Критерии готовности\n• Администратор создаёт заявку меньше чем за 30 секунд.\n• Статус меняется в один клик.\n• Заявка без ответа дольше 15 минут подсвечена красным.\n## Данные\nФакт обращения в клинику — особые данные о здоровье: доступ только по логину, хранение по закону страны.\n## Решено по умолчанию\nВход по логину для своих сотрудников (рекомендация).',
    'FAYL · SPEC.md — bizda chiqqan qismi\n# SPEC · Klinika arizalari trekeri\nMuallif: Azamat, boʻlim rahbari, Servis va sifat\n## Muammo va uning narxi\nWhatsApp, Instagram va qoʻngʻiroqlardan arizalar yoʻqoladi: haftasiga ~5 ta.\n## Kim foydalanadi\nCall-markaz administratorlari; rahbar — faqat koʻrish.\n## Asosiy harakat\nArizani qabul qilish va masʼulni belgilash — 2 bosishda.\n## Birinchi versiya\nAriza shakli · holatli roʻyxat · masʼul xodim.\n## Hozir qilmaymiz\nToʻlov, 1C bilan integratsiya, mobil ilova, SMS.\n## Tayyorlik mezonlari\n• Administrator arizani 30 soniyadan kamroq vaqtda yaratadi.\n• Holat bir bosishda oʻzgaradi.\n• 15 daqiqadan ortiq javobsiz ariza qizil rangda ajratiladi.\n## Maʼlumotlar\nKlinikaga murojaat fakti — sogʻliq haqidagi maxsus maʼlumot: kirish faqat login orqali, saqlash mamlakat qonuniga koʻra.\n## Standart boʻyicha hal qilindi\nOʻz xodimlari uchun login orqali kirish (tavsiya).',
  ),
  t(
    'СОВЕТЫ\n• Отвечайте цифрами, даже примерными: «~5 заявок в неделю» лучше, чем «много».\n• В конце /airl-spec перескажет всё в 4–6 предложениях и спросит «Всё верно?» — прочитайте внимательно, это последний момент поправить.\n• Обязательно прочитайте раздел «Решено по умолчанию»: там то, что выбрали не вы.',
    'MASLAHATLAR\n• Raqamlar bilan javob bering, taxminiy boʻlsa ham: «haftasiga ~5 ariza» «koʻp» dan yaxshiroq.\n• Oxirida /airl-spec hammasini 4–6 jumlada qayta aytib, «Hammasi toʻgʻrimi?» deb soʻraydi — diqqat bilan oʻqing, bu tuzatishning oxirgi imkoniyati.\n• «Standart boʻyicha hal qilindi» boʻlimini albatta oʻqing: u yerda siz tanlamagan narsalar bor.',
  ),
  quiz(
    'Проверка · Какой критерий готовности написан правильно — его можно проверить?',
    'Tekshiruv · Qaysi tayyorlik mezoni toʻgʻri yozilgan — uni tekshirish mumkin?',
    [
      opt('Удобный и понятный интерфейс', 'Qulay va tushunarli interfeys'),
      opt('Администратор создаёт заявку меньше чем за 30 секунд', 'Administrator arizani 30 soniyadan kamroq vaqtda yaratadi'),
      opt('Система работает быстро', 'Tizim tez ishlaydi'),
    ],
    1,
  ),
  ask(
    'Упражнение 2.1 · Боль и её цена из вашего SPEC.md: «сейчас я делаю X, и это стоит Y»',
    '2.1-mashq · SPEC.md dagi muammo va uning narxi: «hozir men X qilaman va bu Y ga tushadi»',
  ),
  ask(
    'Упражнение 2.2 · Вставьте 3 критерия готовности из вашего SPEC.md',
    '2.2-mashq · SPEC.md dan 3 ta tayyorlik mezonini qoʻying',
  ),
  ask(
    'Упражнение 2.3 · Что /airl-spec записал в «Решено по умолчанию»? Согласны ли вы?',
    '2.3-mashq · /airl-spec «Standart boʻyicha hal qilindi» boʻlimiga nima yozdi? Rozimisiz?',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 3 · ПОДГОТОВКА ПРОЕКТА
  // ═══════════════════════════════════════════════════════════════════
  img('step-3.png', 'Шаг 3 · Подготовка проекта · 3-qadam · Loyihani tayyorlash'),
  t(
    'ШАГ 3 · ПОДГОТОВКА ПРОЕКТА\n**Цель:** чтобы проект хранился надёжно и агент всегда работал по одним правилам.\n**Как:**\n1. На github.com нажмите **New repository**, имя — tracker-zayavok, видимость — **Private**.\n2. **SPEC.md и ARCHITECTURE.md оставьте в корне** — там их ищут все навыки AIRL.\n3. **CLAUDE.md** — правила и память проекта: агент читает его перед каждой задачей. /airl-spec уже записал в него состояние проекта.\n4. Остальная документация — в папке **docs/**: IDEA.md, позже TASKS.md.\n**Результат шага:** приватный репозиторий с этой структурой и первым commit.',
    '3-QADAM · LOYIHANI TAYYORLASH\n**Maqsad:** loyiha ishonchli saqlansin va agent doim bir xil qoidalar boʻyicha ishlasin.\n**Qanday:**\n1. github.com da **New repository** ni bosing, nomi — tracker-zayavok, koʻrinish — **Private**.\n2. **SPEC.md va ARCHITECTURE.md ni ildizda qoldiring** — AIRL koʻnikmalari ularni oʻsha yerdan qidiradi.\n3. **CLAUDE.md** — loyiha qoidalari va xotirasi: agent uni har bir vazifadan oldin oʻqiydi. /airl-spec unga loyiha holatini allaqachon yozgan.\n4. Qolgan hujjatlar — **docs/** papkasida: IDEA.md, keyinroq TASKS.md.\n**Qadam natijasi:** shu tuzilmali yopiq repozitoriy va birinchi commit.',
  ),
  t(
    'ПРОМПТ · для агента Claude Code в VS Code\nПодготовь проект к работе. SPEC.md и ARCHITECTURE.md оставь в корне. Создай папку docs/ и перенеси туда IDEA.md. Проверь CLAUDE.md: в нём должны быть правила — перед каждой задачей читать SPEC.md; делать одну задачу за раз; ничего вне первой версии; никаких паролей, ключей и данных пациентов в коде. Сделай commit «Документы проекта» и отправь в GitHub. Покажи итоговую структуру папок.',
    'PROMPT · VS Code dagi Claude Code agenti uchun\nLoyihani ishga tayyorla. SPEC.md va ARCHITECTURE.md ni ildizda qoldir. docs/ papkasini yarat va IDEA.md ni unga koʻchir. CLAUDE.md ni tekshir: unda qoidalar boʻlsin — har bir vazifadan oldin SPEC.md ni oʻqish; bir vaqtda bitta vazifa; birinchi versiyadan tashqari hech narsa; kodda parol, kalit va bemor maʼlumotlari yoʻq. «Loyiha hujjatlari» commitini qil va GitHubga yubor. Yakuniy papka tuzilmasini koʻrsat.',
  ),
  checklist('Упражнение 3.1 · Отметьте, что готово', '3.1-mashq · Tayyorlarini belgilang', [
    opt('Создан приватный репозиторий в GitHub', 'GitHubda yopiq (private) repozitoriy yaratildi'),
    opt('SPEC.md и ARCHITECTURE.md лежат в корне', 'SPEC.md va ARCHITECTURE.md ildizda turibdi'),
    opt('В CLAUDE.md есть правила для агента', 'CLAUDE.md da agent uchun qoidalar bor'),
    opt('Есть папка docs/ с IDEA.md', 'IDEA.md bilan docs/ papkasi bor'),
    opt('В репозитории нет паролей, ключей и данных пациентов', 'Repozitoriyda parol, kalit va bemor maʼlumotlari yoʻq'),
  ]),
  ask(
    'Упражнение 3.2 · Ссылка на ваш репозиторий (пригласите тренера в репозиторий, чтобы он его видел)',
    '3.2-mashq · Repozitoriyingiz havolasi (trener koʻrishi uchun uni repozitoriyga taklif qiling)',
    'task',
  ),

  // ═══════════════════════════════════════════════════════════════════
  // ШАГ 4 · ПЛАН И МАЛЕНЬКИЕ ЗАДАЧИ
  // ═══════════════════════════════════════════════════════════════════
  img('step-4.png', 'Шаг 4 · План и маленькие задачи · 4-qadam · Reja va kichik vazifalar'),
  t(
    'ШАГ 4 · ПЛАН И МАЛЕНЬКИЕ ЗАДАЧИ\n**Цель:** разбить первую версию из SPEC.md на шаги, которые агент сделает без ошибок.\n**Как:** правило одно — **одна задача = один результат, который вы проверите за 5 минут**: открыли, нажали, увидели. Агент хорошо делает маленькие задачи и путается в больших.\nПлохо: «Сделай трекер заявок». Хорошо: «Сделай форму новой заявки с полями имя, телефон, источник».\n**Результат шага:** файл docs/TASKS.md — 5–7 задач с чекбоксами и способом проверки.',
    '4-QADAM · REJA VA KICHIK VAZIFALAR\n**Maqsad:** SPEC.md dagi birinchi versiyani agent xatosiz bajaradigan qadamlarga boʻlish.\n**Qanday:** qoida bitta — **bitta vazifa = 5 daqiqada tekshiradigan bitta natija**: ochdingiz, bosdingiz, koʻrdingiz. Agent kichik vazifalarni yaxshi bajaradi, kattalarida adashadi.\nYomon: «Arizalar trekerini qil». Yaxshi: «Ism, telefon, manba maydonlari bilan yangi ariza shaklini qil».\n**Qadam natijasi:** docs/TASKS.md fayli — belgilar va tekshirish usuli bilan 5–7 ta vazifa.',
  ),
  t(
    'ПРОМПТ · копируйте агенту\nПрочитай SPEC.md. Разбей первую версию на 5–7 маленьких задач, каждую можно проверить за 5 минут без программирования. Для каждой напиши: что сделать и как я проверю результат. Сохрани список в docs/TASKS.md с чекбоксами «- [ ]». Код пока не пиши.',
    'PROMPT · agentga nusxalang\nSPEC.md ni oʻqi. Birinchi versiyani 5–7 ta kichik vazifaga boʻl, har birini dasturlashsiz 5 daqiqada tekshirish mumkin boʻlsin. Har biri uchun yoz: nima qilish kerak va natijani qanday tekshiraman. Roʻyxatni «- [ ]» belgilari bilan docs/TASKS.md ga saqla. Hozircha kod yozma.',
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
    'ШАГ 5 · ПЕРВЫЙ ЦИКЛ: ЗАДАЧА → ПРОВЕРКА → ФИКСАЦИЯ\n**Цель:** получить первую работающую функцию и научиться ритму, в котором дальше строится весь проект.\n**Как:**\n1. **Ставим задачу** — одну, из TASKS.md.\n2. **Агент делает** — читает SPEC.md и CLAUDE.md, пишет код.\n3. **Проверяем сами** — открываем и пробуем так, как сделал бы пользователь.\n4. **Фиксируем** — commit в GitHub и галочка в TASKS.md. К этой версии теперь всегда можно вернуться.\nНе работает — опишите агенту, что видите, и повторите цикл. К следующей задаче — только после проверки.\n**Результат шага:** задача 1 готова, проверена и закоммичена.',
    '5-QADAM · BIRINCHI SIKL: VAZIFA → TEKSHIRUV → SAQLASH\n**Maqsad:** birinchi ishlaydigan funksiyani olish va butun loyiha keyin quriladigan ritmni oʻrganish.\n**Qanday:**\n1. **Vazifa beramiz** — bittasini, TASKS.md dan.\n2. **Agent bajaradi** — SPEC.md va CLAUDE.md ni oʻqiydi, kod yozadi.\n3. **Oʻzimiz tekshiramiz** — foydalanuvchi qanday qilsa, shunday ochib sinab koʻramiz.\n4. **Saqlaymiz** — GitHubga commit va TASKS.md da belgi. Endi bu versiyaga doim qaytish mumkin.\nIshlamasa — agentga nimani koʻrayotganingizni yozing va siklni takrorlang. Keyingi vazifaga — faqat tekshiruvdan keyin.\n**Qadam natijasi:** 1-vazifa tayyor, tekshirilgan va commit qilingan.',
  ),
  t(
    'ПРОМПТ · задача для агента\nПрочитай SPEC.md и docs/TASKS.md. Сделай только задачу 1: форма «Новая заявка» с полями имя, телефон, источник. Ничего сверх этого. Когда закончишь — объясни простыми словами, как мне проверить результат, и отметь задачу в docs/TASKS.md.',
    'PROMPT · agent uchun vazifa\nSPEC.md va docs/TASKS.md ni oʻqi. Faqat 1-vazifani bajar: ism, telefon, manba maydonlari bilan «Yangi ariza» shakli. Bundan ortiq hech narsa qilma. Tugatgach — natijani qanday tekshirishimni oddiy soʻzlar bilan tushuntir va vazifani docs/TASKS.md da belgila.',
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
    'ШАГ 6 · ТИПИЧНЫЕ ОШИБКИ ВАЙБКОДЕРА — И КАК ИХ ИЗБЕЖАТЬ\n**Цель:** не наступать на грабли, на которые наступают почти все в первом проекте.\n• **Всё сразу одним промптом** → делите на задачи из TASKS.md.\n• **Нет SPEC.md — агент додумывает** → сначала /airl-spec, и каждую задачу начинайте с «Прочитай SPEC.md».\n• **Не проверил — уже следующая задача** → сначала проверка, потом новая задача.\n• **Нет коммитов** → commit после каждой рабочей задачи, тогда всегда можно откатиться.\n• **Ключи и пароли в чате с ИИ** → никогда; секреты хранятся отдельно, данные пациентов — тоже.\n• **«Сделай красиво»** → пишите проверяемо: «кнопка зелёная, текст 18px, статус меняется в один клик».',
    '6-QADAM · VAYB-KODERNING KOʻP UCHRAYDIGAN XATOLARI — VA ULARDAN QANDAY QOCHISH\n**Maqsad:** birinchi loyihada deyarli hamma qiladigan xatolarni takrorlamaslik.\n• **Hammasini bitta promptda** → TASKS.md dagi vazifalarga boʻling.\n• **SPEC.md yoʻq — agent oʻzicha toʻqiydi** → avval /airl-spec, har bir vazifani «SPEC.md ni oʻqi» bilan boshlang.\n• **Tekshirmay — keyingi vazifaga** → avval tekshiruv, keyin yangi vazifa.\n• **Commit yoʻq** → har bir ishlaydigan vazifadan keyin commit, shunda doim orqaga qaytish mumkin.\n• **Kalit va parollar SI chatida** → hech qachon; sirlar alohida saqlanadi, bemorlar maʼlumotlari ham.\n• **«Chiroyli qil»** → tekshiriladigan qilib yozing: «tugma yashil, matn 18px, holat bir bosishda oʻzgaradi».',
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
      opt('Текст SPEC.md и описание ошибки', 'SPEC.md matni va xato tavsifi'),
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
  t(
    'ШАГ 7 · ИТОГОВЫЙ ЧЕКЛИСТ\n**Цель:** убедиться, что проект готов к следующему уроку.\n**Как:** отметьте каждый пункт честно. Галочка «Ответ принят» появится, когда отмечены все шесть.\n**Результат шага:** проект, в котором агент работает по правилам, и первая готовая функция.',
    '7-QADAM · YAKUNIY CHEK-LIST\n**Maqsad:** loyiha keyingi darsga tayyorligiga ishonch hosil qilish.\n**Qanday:** har bir bandni halol belgilang. «Javob qabul qilindi» belgisi oltitasi ham belgilanganda chiqadi.\n**Qadam natijasi:** agent qoidalar boʻyicha ishlaydigan loyiha va birinchi tayyor funksiya.',
  ),
  checklist('Итоговый чеклист — отметьте всё, что готово', 'Yakuniy chek-list — tayyorlarini belgilang', [
    opt('Идея на одной странице: пользователь, проблема, метрика', 'Bir sahifalik gʻoya: foydalanuvchi, muammo, oʻlchov'),
    opt('SPEC.md от /airl-spec: боль и цена, первая версия, проверяемые критерии', '/airl-spec dan SPEC.md: muammo va narxi, birinchi versiya, tekshiriladigan mezonlar'),
    opt('Репозиторий в GitHub: SPEC.md, CLAUDE.md, docs/', 'GitHub repozitoriysi: SPEC.md, CLAUDE.md, docs/'),
    opt('docs/TASKS.md: задачи, каждая проверяется за 5 минут', 'docs/TASKS.md: har biri 5 daqiqada tekshiriladigan vazifalar'),
    opt('Первая задача сделана, проверена и закоммичена', 'Birinchi vazifa bajarildi, tekshirildi va commit qilindi'),
    opt('Ключей и личных данных нет ни в коде, ни в чате', 'Kalit va shaxsiy maʼlumotlar kodda ham, chatda ham yoʻq'),
  ]),
  t(
    'ЗАДАЧА НЕДЕЛИ\nДоведите свой мини-проект до конца шага 5: идея, SPEC.md от /airl-spec, репозиторий с CLAUDE.md и docs/, TASKS.md и хотя бы одна задача, сделанная агентом, проверенная и закоммиченная. Пригласите тренера в репозиторий и загрузите SPEC.md ниже. Тренер проверит и даст обратную связь в LMS.',
    'HAFTA VAZIFASI\nMini-loyihangizni 5-qadam oxirigacha yetkazing: gʻoya, /airl-spec dan SPEC.md, CLAUDE.md va docs/ bilan repozitoriy, TASKS.md va agent bajargan, tekshirilgan va commit qilingan kamida bitta vazifa. Trenerni repozitoriyga taklif qiling va quyida SPEC.md ni yuklang. Trener tekshiradi va LMS da fikr-mulohaza beradi.',
    'task',
  ),
  fileAsk(
    'Загрузите ваш SPEC.md (или PDF/DOCX)',
    'SPEC.md faylingizni yuklang (yoki PDF/DOCX)',
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
