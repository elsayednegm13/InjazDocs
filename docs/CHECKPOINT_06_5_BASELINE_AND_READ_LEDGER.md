# Checkpoint 06.5 — خط الأساس وسجل القراءة

لم تُقرأ كل ملفات المشروع. الجرد أدناه هو ما فُتح في هذه الجولة، لا ما وُجد في تقارير سابقة.

## البيئة MEASURED

- نظام التشغيل: Windows 10.0.26300
- Node: `v24.19.0`
- pnpm عبر corepack: 12.11.2 كما ظهر أثناء تثبيت الصندوق
- الجذر: `I:\WORK\InjazDocs`
- Git: غير موجود
- Vite المثبت: 7.3.7
- Hono المثبت: 4.13.13
- `@cloudflare/vite-plugin`: 1.63.1
- Wrangler: 4.149.0
- Miniflare: `5.20261006.1-alpha` مثبتة لأن `package.json` الخاص بالإضافة يثبّتها بهذا الرقم، ومعها `workerd` `1.20261006.1`
- undici الذي ظهر في أثر الخطأ: 7.29.1
- حقل الإضافة: `"workers-sdk": { "prerelease": true }`

سبب ألفا Miniflare: OBSERVED في تبعيات الإضافة 1.63.1، وليس قراراً مستقلاً في `package.json` للتطبيق. التطبيق يطلب `^1.13.12` و `wrangler` `^4.42.2`، والقفل يثبّت 1.63.1 و 4.149.0.

## ملفات قُرئت في هذه الجولة

| الملف | ما قُرئ |
| --- | --- |
| `package.json` | التبعيات والسكربتات |
| `node_modules/@cloudflare/vite-plugin/package.json` | الإصدار، التبعيات المثبتة، peer `vite` و `wrangler` |
| `vite.config.ts` | تعليق `hmr: { overlay: false }` وسطوره |
| `src/app/router.tsx` | كل المسارات |
| `src/app/shell.tsx` | القائمة، اللغة، الغلاف |
| `src/main.tsx` | `QueryClient` بلا `staleTime`، و`SessionProvider` يغلّف كل المسارات |
| `src/index.css` | رموز اللون والخط `Segoe UI` |
| `server/services/reports.ts` | `overview` بالكامل، ثم عُدّل |
| `server/services/actor.ts` | `caseVisibilitySql` |
| `server/services/customers.ts` | `listCustomers` وبداية `createCustomer` |
| `server/http/app.ts` | مواضع `POST` ومسار العملاء |
| `src/features/dashboard/DashboardPage.tsx` | الحقول المعروضة |
| `src/features/cases/CasesPages.tsx` | عناوين النموذج والقائمة عبر البحث |
| `src/features/track/TrackPage.tsx` | استخدام الرمز ورقم الفاتورة |
| `src/app/i18n.ts` | مفتاح `exportflow.lang` |
| `src/components/ui` | أربعة ملفات فقط: `button` `input` `status` `chrome`. Radix المستخدم في المصدر هو `Slot` فقط |
| سكربتات 06.4 | الحارس، الخادم، المسبار، إعادة التهيئة، التمهيد، وأجزاء البذر المعروفة |

## ما بقي دون قراءة كاملة

خدمات `cases.ts` (ما عدا توقيع `getCaseOverview` و`db.batch` عبر البحث)، `documents.ts`، `bookings.ts`، `reminders.ts`، `tracking.ts` ما عدا ما ثُبّت سلوكه بالطلبات، ملفات `src/locales` كاملة، معظم الاختبارات، `worker/index.ts`، ومكوّنات النماذج الداخلية لكل تبويب القضية. لا يُدّعى فحص كامل للمستودع.

بصمات 78 ملفاً في `docs/performance/checkpoint-06-5/source-hashes.json`. البصمة دليل على الوجود والحجم، لا على أن المحتوى قُرئ.

## خط الأساس الوظيفي قبل أي ترقية

مجموعة البيانات: 500 عملية اصطناعية، البذرة `checkpoint-06-4-v1` عبر السكربت الحالي. المنفذ 43176. المراقب مفتوح لأن `CI` لم يُضبط.

| السيناريو | النتيجة |
| --- | --- |
| 10 إقلاعات باردة ثم `POST /api/auth/sign-in/email` واحد لكل إقلاع | 10/10 الحالة 200، وصلت إلى Hono، 0 إعادة ضبط. MEASURED |
| سلسلة 20 طلباً لكل مسار بعد إحماء | 0 فشل و 0 إعادة ضبط. الوسيط في جدول الأداء |
| 100 قراءة متتالية لتفاصيل `pcase-0` | 100/100 نجاح، الوسيط 277 مللي ثانية |
| خمول 1 و 3 و 6 و 15 و 30 ثانية ثم لوحة واحدة | 5/5 نجاح |
| توازٍ 1/2/4/8/16 | 0 فشل. وسيط 16 هو 2889 مللي ثانية على 64 طلباً |
| ضابط التصدير | قائمة القضايا 250، ولوحة الأرقام قبل الإصلاح 500. MEASURED |
| تتبع عام | الرمز الفعّال 200 بلا `invoice_total`، والملغى 410 |
| كتابة عميل واحد | 201 مرة واحدة، الإجمالي +1 |

تفاصيل الأرقام في `docs/CHECKPOINT_06_5_PERFORMANCE_BEFORE_AFTER.md`.
