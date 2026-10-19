# خريطة المرجع البصري — 06.7.1

الصور فُتحت: TARGET_01 وTARGET_02، 1672×941.

## TARGET_01 لوحة

| المنطقة | الهدف | المصدر | التصنيف | التنفيذ |
| --- | --- | --- | --- | --- |
| شريط يمين | تنقل فعلي | shell NavItems | IMPLEMENTABLE | شريط بحري + drawer تحت 1024 |
| أعلى | بحث ولغة ومستخدم | shell | IMPLEMENTABLE | نفس `?q=` والخروج |
| بطل سفينة | زينة | لا أصل مرخّص | VISUAL_REFERENCE_ONLY | تركيب CSS لا صورة المرجع |
| KPI | أعداد حقيقية | dashboard.counts | ADAPT | 4 بطاقات بلا +12% |
| إجراءات اليوم | تذكيرات اليوم والعاجل | due | ADAPT | أول 8 حسب due_at |
| تنبيهات | تجميع عرض | due bands | ADAPT | عاجل/اليوم/قادم |
| مواعيد | due قادم | due | IMPLEMENTABLE | بلا اختراع تاريخ |
| دونات | نسب وهمية | لا مقام/مقسوم | BLOCKED_BY_MISSING_REAL_SOURCE | قوائم حالة |
| مستندات/بضاعة | مساران | docs_pending وcourier_open | ADAPT | فصل صريح |
| نشاط | أحداث | recent | IMPLEMENTABLE | event_type/summary |

## TARGET_02 قضايا

| المنطقة | المصدر | التصنيف | التنفيذ |
| --- | --- | --- | --- |
| ملخص نسب | لا API تاريخي | BLOCKED | أعداد مطلقة من dashboard |
| فلاتر مخترعة | لا عقد | BLOCKED | `?q=` فقط |
| جدول | حقول القائمة | ADAPT | بلا UCR مخترع |
| لوحة سياق غنية | تفصيل قد يكرر الجلب | ADAPT | معاينة من الصف + فتح الملف |
| ترقيم 74 | الواجهة لا تعرض الصفحات | VISUAL_REFERENCE_ONLY | ترتيب الخادم updated_at |
| دوائر 80% | لا نسبة | BLOCKED | محذوفة |
