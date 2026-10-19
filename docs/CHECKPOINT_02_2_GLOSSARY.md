# Checkpoint 02.2 glossary

Arabic is Modern Standard Arabic suitable for Egyptian / Middle East professional operations. Trade abbreviations stay in Latin. Identifiers stay LTR via `<bdi dir="ltr">`.

| Concept | English | Arabic | Notes |
| --- | --- | --- | --- |
| Export operation / case | Export operation | عملية تصدير | Case reference is an ID, not translated |
| Invoice | Invoice | فاتورة | |
| Commercial invoice | Commercial invoice | فاتورة تجارية | |
| Packing list | Packing list | قائمة التعبئة | |
| Certificate of origin | Certificate of origin | شهادة المنشأ | |
| Bill of lading | Bill of lading | بوليصة الشحن | |
| Shipping booking | Shipping booking | حجز بحري | |
| Booking confirmation | Booking confirmation | تأكيد الحجز البحري | PDF scan, not a live booking API |
| UCR | UCR | الرقم المرجعي الموحد (UCR) | Keep UCR |
| Vessel | Vessel | السفينة | |
| Voyage | Voyage | الرحلة | |
| Container slot | Container slot | خانة حاوية | Number may be unassigned |
| Loading port | Port of loading | ميناء الشحن | |
| Discharge port | Port of discharge | ميناء التفريغ | |
| ETD | ETD | موعد المغادرة المتوقع | Keep ETD in compact labels |
| ETA | ETA | موعد الوصول المتوقع | Keep ETA |
| Planned | Planned | مخطط | Distinct from actual |
| Actual | Actual | فعلي | |
| Bank originals | Bank originals | الأصول الورقية لدى البنك | Scans stay in the app |
| Bank review | Bank review | مراجعة البنك | |
| Courier dispatch | Courier dispatch | إرسال بالبريد السريع | Manual first version |
| In transit | In transit | في الطريق | |
| Delivered | Delivered | تم التسليم | Documents vs cargo stay separate |
| Overdue | Overdue | متأخر عن الموعد | From reminder due timestamps |
| Snooze | Snooze | تأجيل التذكير | |
| Waived | Waived | تم الإعفاء من المستند | Upload ≠ approved |
| Under review | Under review | بانتظار المراجعة | |
| Approved | Approved | معتمد | |
| Denied permission | You do not have permission | ليس لديك صلاحية | Never show permission IDs |
| Tracking link expired | Tracking link unavailable | رابط المتابعة غير متاح أو انتهت صلاحيته | Neutral; no customer enumeration |
| Customer delivery | Delivered to customer | سُلّمت إلى العميل | Not port arrival |
| Port arrival | Arrived at port | وصلت إلى الميناء | Not customer delivery |
| FOB / CFR | FOB / CFR | FOB / CFR | Incoterms, not transport type |
| DHL | DHL | DHL | Manual tracking number + official link |
| IBAN / SWIFT | IBAN / SWIFT | رقم الآيبان / رمز السويفت | LTR values |

Untranslated by design: user-entered names, invoice numbers, container ISO numbers, tracking numbers, emails, case references, booking numbers, and custom rule names that are not system IDs `rr-doc-due` / `rr-review`.
