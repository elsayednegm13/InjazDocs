# خط الأساس — Checkpoint 06.5.3

## قبل تعديل المجمع، CURRENT_BEFORE_MEASUREMENT

الخادم: Vite 7.3.7 على `127.0.0.1:43176`، حالة `.wrangler-perf`، الأسرار من `.dev.vars.perf`.

اثنا عشر `POST` متتالياً بجسم JSON إلى مسار الفحص المغلق (الاستجابة المتوقعة 404 لأن علم العطل لم يصل إلى العامل):

| الترتيب | النتيجة |
| --- | --- |
| الزوجي | HTTP 404 ودخول Hono |
| الفردي | HTTP 500 وصفحة HTML فيها `fetch failed` |

6 نجاحات و6 إخفاقات، تناوب صارم. السجل: `TypeError > Error:ECONNRESET` ثم `Internal server error: fetch failed` من `undici` `processResponse` → `Miniflare.dispatchFetch` → إضافة Vite. لا سطر `[exportflow-handler] enter` قبل هذه الإخفاقات. التصنيف: `PRE_HANDLER_TRANSPORT_FAILURE`.

ثمانية `GET /api/v1/health` فورية: 8/8 الحالة 200، صفر `ECONNRESET`. عشرة `POST` بجسم فارغ: 0 إخفاق. عشرة `POST` JSON بفاصل 300 مللي ثانية: 0 إخفاق.

## المجدول قبل إصلاح المؤشر

النبضة الثانية على 2650 تذكيراً مستحقاً: HTTP 200 في 41050 مللي ثانية، الإشعارات بقيت 100، و`last_evaluated_at` تجدد. العمل أُعيد على الصفوف نفسها ولم يتقدم التراكم. OBSERVED.

## أدلة سابقة لا تُعاد قياسها

220528 مللي ثانية و537447 مللي ثانية من 06.5.2 و06.5.1 تبقى `PRIOR_EVIDENCE`.
