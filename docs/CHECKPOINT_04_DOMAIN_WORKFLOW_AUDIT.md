# تدقيق تدفقات العمل — Checkpoint 04

المصدر: `server/domain/transitions.ts` و`case-completion.ts` وخدمات `documents` و`bank-courier` و`bookings` و`reminders` و`tracking`. الاختبارات المذكورة من ملفات E2E القائمة، وتُعاد في تشغيل القبول إن نجح.

## المستندات

`MISSING → UPLOADED → UNDER_REVIEW → APPROVED`. الرفع لا يعتمد. الإعفاء من `MISSING` أو `NEEDS_CORRECTION` ويحتاج سببًا في `reviewDocument`. النسخ في `document_versions`. اختبار E2E-06 وE2E-07.

## البنك مقابل المباشر

البنك: تجهيز، مسح، جاهز للتسليم، لدى البنك، مراجعة أو تصحيح، موافقة، بريد، تسليم مستندات. المباشر لا يمر بموافقة البنك. `assertRouteChange` يمنع التحويل من البنك إلى المباشر أثناء `HANDED_TO_BANK` أو `BANK_REVIEW` أو `COURIER_DISPATCHED`. E2E-08 وE2E-09.

البريد يدوي. `carrierTrackingUrl` قائمة شركات معروفة فقط. لا استدعاء DHL.

## الحجز والحاويات

الحجز يُنشئ خانات `PLANNED` بلا رقم. الرقم لاحقًا مع فحص ISO ما لم يُطلب تجاوز. وصول الميناء ليس `DELIVERED_TO_CUSTOMER`. إغلاق العملية يتطلب مسار المستندات مكتملًا وكل حاوية غير ملغاة مسلّمة، أو استثناء إغلاق بصلاحية `export_cases.close`. E2E-10 وE2E-11.

## التذكير

`recomputeRemindersForCase` يعيد بناء المثيلات من القواعد. `processDueReminders` يتخطى الغفوة التي لم يحن وقتها، ثم يعيد الحساب، ثم `INSERT OR IGNORE` على `notification_deliveries` بمفتاح `reminder_id + cycle_key`. القيد الفريد في الهجرة `0001`. المفتاح يتضمن ساعة UTC (`slice(0, 13)`)، فالتكرار داخل الساعة ممنوع، وقد يتكرر التنبيه في ساعة لاحقة ما دام المثيل `ACTIVE`. E2E-15 يثبت أن الموافقة تلغي التذكير رغم الغفوة. التسليم البريدي الخارجي غير موجود؛ القناة `IN_APP` فقط.

## الرابط العام

`createTrackingLink` يخزّن `token_hash` لا الرمز الخام. الإلغاء والتدوير في `tracking.ts`. `publicTracking` يعيد مرجع العملية والفاتورة والموانئ وحالة المسار والبريد والتواريخ حسب `display_scope_json`. الاستعلام يقرأ `invoice_total_minor` ثم **لا يضعه في الكائن المُعاد**. لا مرفقات ولا ملاحظات موظفين. الرمز غير الصالح أو الملغى أو المنتهي: 410 بنفس الرسالة. E2E-12.

## الحقول المخصصة

خمسة كيانات. الإلزام حسب المرحلة في `customFieldsRequiredNow`. الإيقاف يبقي القيمة. الحساس يُحجب بلا `settings.manage`. نوع `MONEY` في `shared/enums.ts` مرفوض من الخدمة. متعمد وغير منفَّذ.
