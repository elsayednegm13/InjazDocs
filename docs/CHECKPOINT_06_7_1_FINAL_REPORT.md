# Checkpoint 06.7.1 — مساحة عمليات متميزة من مرجعين بصريين

## 01. الغلاف
النقطة 06.7.1 فقط. الجذر `I:\WORK\InjazDocs`. التنفيذ 18 أكتوبر 2026 محليًا. الحالة `PARTIAL`.

## 02. ملخص الموظف
الغلاف بحري على اليمين في العربية، ودرج بدل الشريط المقصوص عند 768. اللوحة: ترحيب، أربعة أعداد حقيقية، إجراءات اليوم، تنبيهات قابلة للفتح، مساران منفصلان للمستندات والبضاعة بلا دونات. القائمة: أعداد مطلقة، بحث `?q=`، جدول أو بطاقة، معاينة من حقول الصف.

## 03. أحكام منفصلة
تنفيذ الواجهة: تم. البصري: `OWNER_PENDING`. الأمن: 403 مؤكد. الأداء: جزئي. الإنتاج: غير موافق. السحابة: لم تُشغَّل.

## 04. ما لم يُفعل
لا نشر، لا Git، لا فتح قاعدة المطوّر، لا هجرة، لا تغيير عقد API، لا 06.8، لا شراء خط أو أصل.

## 05. الغرض
منصة عمليات تصدير ثنائية اللغة. الوحدة `EF-…`. ليست لوحة تسويق ولا تتبعًا حيًا للناقل.

## 06. العقود المجمّدة
فاتورة صريحة، القاعدة جيم، BANK≠DIRECT، بريد≠بضاعة، وصول الميناء≠تسليم العميل. بقيت.

## 07. الإصدارات
Node v24.19.0. Vite 7.3.7. Vitest الحالي 33/33. Playwright كان 34 اختبارًا؛ يُحدَّث بعد الجولتين.

## 08. المراجع
TARGET_01 `e59f5281396afcca561b01d1faa0fd3848ff9d16f5da3d41bcdbb74bfe8a676f`. TARGET_02 `cb13aba69f7b1ac87773b29265fb30e5f1705c54179274eaf81227c8beae62a6`. كلاهما فُتح، 1672×941. النسخ في `docs/design-references/exportflow-premium-workspace-0671/`.

## 09. الهدف أ
لوحة عربية: شريط يمين، بطل، KPI، إجراءات، تنبيهات، مواعيد، مستندات/بضاعة، نشاط.

## 10. الهدف ب
قائمة عمليات: ملخص، بحث، جدول، معاينة. النسب والدوائر والترقيم 74 مرفوضة كحقيقة.

## 11. أساس 06.7
لقطات تاريخية في الحزمة. الأساس الفوري لهذه النقطة: `docs/qa-screenshots/checkpoint-06-7-1/before/`.

## 12. المصدر
الغلاف واللوحة والقائمة كما في سجل العقود. الأعداد من `/api/v1/dashboard`. القائمة من `/api/v1/export-cases?q=`.

## 13. العزل
حارس المسار + حذف SELECT على قاعدة المطوّر. اختبار وحدة 2/2.

## 14. قاعدة المطوّر
رئيسي 638976 بايت، 2026-10-17T20:08:31Z. WAL 37112 بايت، 2026-10-18T18:36:14Z قبل الجولة الكاملة. لم يُفتح. المطابقة التاريخية `UNVERIFIABLE_NO_PRIOR_HASH`.

## 15. الأسرار
بناء معزول. الحارس: publishable output is clean.

## 16. الاتجاه
Premium Operations Workspace من صور المالك. 21st.dev رُفض لأن النتائج رسوم اتجاه. Mobbin غير متاح بدون خطة.

## 17. التفسير
انظر `CHECKPOINT_06_7_1_VISUAL_REFERENCE_MAPPING.md`.

## 18. ما لم يُنسخ
+12%، دونات 65%/56%، دوائر 80%/100%، أعلام، UCR مخترع، صفحات تنقل غير موجودة، صورة السفينة.

## 19. Tailwind v4
`@theme` في `src/index.css` كما في القسم 20.

## 20. الألوان
ورق `#f7f9fc`، حبر `#182839`، تيل `#0d9488`، شريط `#10243a`. نص البطل أبيض على البحري.

## 21. الخط
Segoe / Noto Sans Arabic / Tahoma. لا ملف ترخيص محلي. لا إثبات `document.fonts.check` لملف woff2.

## 22. الأيقونات
lucide-react فقط: LayoutDashboard، ClipboardList، Boxes، FileStack، Package، Bell، Ship، Menu، Search، LogOut.

## 23. الغلاف
المدير يرى المستخدمين والإعدادات. الضابط لا يراهما.

## 24. الجوال واللوح
390 و768: زر قائمة ودرج وEscape. لا شريط أفقي مقصوص. 200% غير مختبر.

## 25. ترتيب اللوحة
بطل ثم KPI ثم إجراءات اليوم ثم تنبيهات ثم مواعيد/مستندات/بضاعة ثم نشاط.

## 26. KPI
total_cases، docs_pending، courier_open، overdue من الخادم. بلا اتجاه أسبوعي.

## 27. إجراءات اليوم
urgent+today، أقصى 8، رابط الملف، رابط التذكيرات.

## 28. التنبيهات
تجميع عرضي حسب النطاق الزمني فقط. الحالات ACTIVE/PENDING كما يعيدها الخادم.

## 29. المواعيد
upcoming من due_at. تقويم القاهرة لم يُغيَّر.

## 30. المستندات
docs_pending وbank_pending كنص. بلا نسبة.

## 31. البضاعة
نص صريح: لا إجمالي تسليم بضاعة. البريد منفصل.

## 32. النشاط
`recent` من نفس الرد. لا أحداث مخترعة.

## 33. جدول المكتب
المرجع، العميل، الفاتورة، الدولة، المسار، الإجراء، حالة المستندات، استقلال البضاعة، الحالة.

## 34. اللوح والجوال
بطاقات تحت 1024 بكسل.

## 35. البحث
`?q=` في الأعلى وفي الصفحة. لا فلاتر جديدة.

## 36. المعاينة
من صف القائمة فقط. لا جلب تفصيلي. لوحة أغنى: DEFERRED.

## 37. الملف الكامل
المسار `/export-cases/:id` بقي.

## 38–44. الانحدارات
BANK/DIRECT/البريد/الحاويات/القاعدة جيم/الحقول/التتبع تُثبتها مجموعة e2e بعد آخر تعديل. لا تغيير دلالي في الكود.

## 45. الترجمة
مفاتيح جديدة متقابلة عربي/إنجليزي. المراجع داخل `Ltr`.

## 46. الوصول
لوحة مفاتيح جزئية (Escape+بحث). قارئ شاشة غير مختبر.

## 47. الحالات
خطأ اللوحة يظهر مع إعادة محاولة GET. القائمة الفارغة EmptyState. لا أصفار عند الفشل.

## 48. قبل
24/24 في `docs/qa-screenshots/checkpoint-06-7-1/before/`. بذرة INV-DESK-158307.

## 49. بعد
24/24 فُتحت في `after/`. بذرة INV-DESK-625064. ليست نفس البذرة لكن نفس نوع التثبيت.

## 50. الفرق عن الهدف أ
لا سفينة مصورة. لا نسب. لا 74 عميلًا. التركيب: شريط وKPI وإجراءات ومساران.

## 51. الفرق عن الهدف ب
لا دوائر تقدم. لا ترقيم 10–74. معاينة خفيفة. الجدول يمرّر داخليًا عند الضيق.

## 52. المقارنة
قبل وبعد ليسا نفس الـ fixture id. كلاهما قضية DIRECT واحدة للضابط.

## 53. الزمن
قبل وسيط 1428ms (خمس أولى). بعد وسيط 1019ms. N=6 مختلط. PARTIAL.

## 54. الحزمة
CSS 31.71 ك.ب. JS 554.05 ك.ب. خط 0.

## 55. الجودة
`tsc -b` نجاح. oxlint تحذير قديم في CustomFieldsPanel. Vitest 33/33.

## 56. Playwright 1
2026-10-18T20:19:00Z إلى 20:29:48Z. 34/34، خروج 0، 10.7 دقيقة، retries=0. لا `ECONNRESET` ولا `fetch failed` في السجل. مقام الطلبات غير مُقاس.

## 57. Playwright 2
2026-10-18T20:30:15Z إلى 20:42:35Z. 34/34، خروج 0، 12.2 دقيقة، retries=0. نفس غياب السطرين.

## 58. العيوب
P1 أُغلق: قص تنقل 768. P2 مفتوح: لا خط، لا قارئ شاشة. P3: أعمدة الجدول تضيق عند المعاينة؛ سباق بطاقات القائمة على 390.

## 59. الملفات
انظر سجل التغيير. لا Git.

## 60. البوابات والتوقف
G00 PASS. G01 PASS الصورتان فُتحتا. G02 PASS. G03 PASS لهذه النقطة (لا فتح SQLite مطوّر). G04 PASS. G05 PASS. G06 PARTIAL تطابق بصري بلا زينة مخترعة. G07 PARTIAL. G08 PASS على 390/768/1366 المشاهَدة. G09 PASS. G10 PASS. G11 PASS. G12 PASS 24. G13 PASS 24 مراجعة. G14 PASS عبر قفل الفاتورة في 34/34. G15 PASS. G16 PASS. G17 PARTIAL. G18 PARTIAL خط نظام. G19 PARTIAL. G20 PASS. G21 PASS. G22 PASS. G23 PASS. G24 PASS. G25 OWNER_PENDING.

### الجداول أ–ع
أ) العقود مجمّدة. ب) خريطة المرجع. ج) بلا نسب ودون سفينة. د) ملفات الواجهة السبعة. هـ) أربعة أعداد من dashboard. و) مدير مقابل ضابط و403. ز) مستندات≠بضاعة. ح) القاعدة جيم لم تُمس. ط) 24 خلية. ي) Escape وبحث. ك) أزمنة القسم 53. ل) الأوامر. م) عزل وحارس نظيف. ن) عيوب 58. س) بوابات 60. ع) مخاطر موروثة.

CHECKPOINT: 06.7.1
FINAL_STATUS: PARTIAL
PROJECT_ROOT: I:\WORK\InjazDocs
REFERENCES_TARGET_A_OPENED: YES
REFERENCES_TARGET_B_OPENED: YES
VISUAL_DIRECTION: PREMIUM_OPERATIONS_WORKSPACE
BACKEND_API_CONTRACTS: UNCHANGED
BUSINESS_RULES: VERIFIED_PRESERVED
PROJECT_ROADMAP: UNCHANGED
DEVELOPER_DB_ISOLATION: PASS
DEVELOPER_DB_HISTORICAL_IDENTITY: UNVERIFIABLE_NO_PRIOR_HASH
CLOUD_STAGING: NOT_RUN
PRODUCTION: NOT_APPROVED
GIT: NOT_TOUCHED
OWNER_VISUAL_APPROVAL: PENDING
DASHBOARD_VISUAL_MATCH: PARTIAL
CASES_VISUAL_MATCH: PARTIAL
SCREENSHOTS_BEFORE: 24/24
SCREENSHOTS_AFTER: 24/24
RTL_AR_EN: PASS
AUTH_DATA_SCOPE: PASS
PERFORMANCE_PARITY: PARTIAL
UNIT_TESTS: 33/33, exit=0
PLAYWRIGHT_RUN_1: 34/34, exit=0, retries=0, transport_faults=0
PLAYWRIGHT_RUN_2: 34/34, exit=0, retries=0, transport_faults=0
PUBLISHABLE_DIST_SECRETS: CLEAN
REMINDER_CRON_PREEXISTING_RISK: OPEN
WORKER_CONCURRENCY_PREEXISTING_RISK: OPEN
LOCAL_320MS_MITIGATION: RETAINED_LOCAL_ONLY
CUSTOM_FOLLOWUP: NOT_IMPLEMENTED_WITHOUT_OWNER_SPEC
NEXT_STAGE: OWNER_APPROVAL_REQUIRED
STOP
