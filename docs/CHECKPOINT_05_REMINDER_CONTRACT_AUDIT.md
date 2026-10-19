# تدقيق عقد التنبيهات — Checkpoint 05

## المسار

حدث تشغيلي → `recomputeRemindersForCase` → صف في `reminder_instances` بمفتاح `dedup_key = rule:target:generation` → `processDueReminders` من `worker/index.ts` `scheduled` → `notification_deliveries`.

الغفوة حالة `SNOOZED` وليست إشعارًا جديدًا. الحل عند زوال الشرط يضع `RESOLVED` ويمسح `snoozed_until` في `upsertInstance`.

## التكرار

المخطط فيه `repeat_every_days` و`repeat_cap` والقيم المزروعة `NULL`. قبل هذا الإصلاح كان `cycle_key` يتضمن ساعة UTC، فيُنشأ إشعار كل ساعة رغم غياب سياسة تكرار.

`notificationCycleKey` في `server/domain/reminders.ts`:

- بلا فاصل: مفتاح `once` ثم لا إشعار آخر عبر الساعات.
- مع `repeat_every_days`: دلو زمني بالأيام، ويتوقف عند `repeat_cap`.

هذا يطبّق العمود الموجود ولا يخترع إيقاعًا ساعيًا. ضبط الفاصل من الواجهة غير مبني؛ القرار في مذكرة المالك.

## الهوية

مستندان ناقصان في عملية واحدة: `target_id` مختلف. نفس النوع في عمليتين: متطلبان مختلفان. تغيير تاريخ الحجز يغيّر `generation` و`cancelOtherGenerations` يلغي الجيل السابق حتى لا يبقى تنبيه التاريخ القديم قابلًا للتنفيذ.

## الغفوة والاعتماد

قبل انتهاء الغفوة الحالة ليست `ACTIVE` فلا يُدرج إشعار. الرفع يُسقط تذكير «غير مرفوع» ويبقي «بانتظار المراجعة» حتى الاعتماد. E2E-15 وE2E-15b يغطيان ذلك.

## التزامن

`INSERT OR IGNORE` مع `UNIQUE (reminder_id, cycle_key)`. لم يُنفَّذ اختبار ضغط عالٍ لعمال متزامنين. الحد المُثبَت هو القيد الفريد في D1.

## النطاق

`listReminders` و`listNotifications` و`snoozeReminder` و`markNotificationRead` تمر بنطاق العملية. طابور لوحة التحكم لم يعد يضم `SNOOZED`.
