# دليل إطلاق ExportFlow v1.0

هذا الدليل يصف ترتيب الإطلاق الأول. هو ليس موافقة على التنفيذ. `pnpm db:migrate:remote` ما زال يرفض الترحيل البعيد. لا تُشغَّل أوامر الإنتاج قبل استبدال كل قيمة `REPLACE_WITH_*` في `wrangler.jsonc`، وقبل موافقة المالك الصريحة.

التطوير المحلي يبقى على الإعداد الأعلى في `wrangler.jsonc` (`exportflow-local`). لا تضبط `CLOUDFLARE_ENV=production` أثناء `pnpm dev`.

## ما يجب أن يكون جاهزًا

- قاعدة D1 جديدة وفارغة، منفصلة عن قاعدة المطوّر المحلية.
- سلة R2 جديدة للإنتاج، وربطها بالاسم `DOCUMENTS`.
- اسم نطاق HTTPS هو نفسه الذي سيفتحه المتصفح. طفرات `/api/v1` ترفض الطلب إذا لم يطابق ترويسة `Origin` قيمة `BETTER_AUTH_URL` حرفًا بحرف.
- `BETTER_AUTH_SECRET` طوله 32 حرفًا على الأقل. الأقصر يمنع إقلاع المصادقة.

## 1. تعبئة معرفات الإنتاج

في `wrangler.jsonc` داخل `env.production` فقط:

| الحقل | القيمة المطلوبة |
|---|---|
| `d1_databases[0].database_id` | معرف D1 الذي يعرضه `wrangler d1 create exportflow-production` |
| `r2_buckets[0].bucket_name` | اسم سلة R2 الحقيقية، بحروف صغيرة |

لا تضع `database_id` المحلي `local-exportflow-not-a-remote-id` في الإنتاج. لا تكتب الأسرار داخل الملف.

`COMPANY_TIMEZONE` للإنتاج مضبوط على `Africa/Cairo`. `nodejs_compat` مفعّل في بيئة الإنتاج كما في الإعداد الأعلى. `TRUST_CF_CONNECTING_IP=1` لأن العامل خلف وكيل Cloudflare فقط؛ لا تفعّله على جهاز التطوير.

## 2. أسرار Cloudflare

من جذر المستودع، بعد `wrangler login`:

```text
pnpm wrangler secret put BETTER_AUTH_SECRET --env production
pnpm wrangler secret put BETTER_AUTH_URL --env production
pnpm wrangler secret put BOOTSTRAP_SECRET --env production
```

ولّد السرين الأول والثالث محليًا ولا تلصقهما في Git:

```text
openssl rand -base64 32
```

`BETTER_AUTH_URL` مثاله `https://exportflow.example.com` بلا شرطة مائلة في الآخر.

مفاتيح التوقيع الأربعة لرفع R2 الموقّع اختيارية، وتُضبط بالطريقة نفسها إذا أردت `productionUploadReady=true`:

`R2_ACCOUNT_ID` و`R2_ACCESS_KEY_ID` و`R2_SECRET_ACCESS_KEY` و`R2_BUCKET_NAME`.

بدونها يعمل الرفع عبر ربط `DOCUMENTS` داخل العامل.

## 3. ترحيلات D1

الترتيب الوحيد الصالح هو `0001` ثم `0002` … حتى `0016`. طبّقها على القاعدة الفارغة مرة واحدة. Wrangler يسجّل الملفات المطبَّقة ولا يعيد تشغيلها. قبل أي قاعدة موجودة، اعرض سجل الترحيلات المطبق فعلًا ولا تفترض أن وجود الملف في المستودع يعني أنه طُبّق هناك.

```text
pnpm wrangler d1 migrations apply exportflow-production --remote --env production
```

لا تستخدم `--local` لهذا الأمر، ولا `pnpm db:migrate:local`، ولا `pnpm db:migrate:remote`. الأخير متعمّد الرفض.

مراجعة القيود على قاعدة فارغة:

| الملف | الأثر | قيد الإقلاع الأول |
|---|---|---|
| `0001_init.sql` | الجداول الأساسية و`PRAGMA foreign_keys = ON` | يجب أن تكون القاعدة فارغة |
| `0002_seed.sql` | الشركة، الأدوار (`role-admin` …)، الصلاحيات، الموانئ، قوالب المستندات | الإدراج ليس `OR IGNORE`؛ الإعادة اليدوية خارج سجل Wrangler تفشل |
| `0003_checkpoint.sql` | `bootstrap_consumed` و`rate_limit_buckets` | عمود جديد على `company_settings` |
| `0004_invoice_revisions.sql` | صلاحية التصحيح ثم جدول المراجعات | يمنح `role-admin` الموجود في `0002`؛ المفتاح يُدرج قبل الربط |
| `0005_idempotency.sql` | سجل عدم التكرار | المفتاح الأجنبي إلى `user` |
| `0006_customer_imports.sql` | جداول الاستيراد | المفاتيح إلى `user` ثم إلى عملية الاستيراد |
| `0007_performance_indexes.sql` | فهارس فقط | `IF NOT EXISTS` |
| `0008_replay_safety_and_import_identity.sql` | أعمدة إضافية وجدول حوادث التعويض | `ALTER TABLE` يفشل إذا أُعيد تشغيل الملف خارج السجل |
| `0009_reports_view_all.sql` | صلاحية تقارير للمدير | `INSERT OR IGNORE` |
| `0010_quotations.sql` | العروض وبنودها ومراجعاتها | `INSERT OR IGNORE` للصلاحيات؛ الجداول الجديدة بمفاتيح `RESTRICT` |
| `0011_company_logo.sql` | شعار الشركة | عمود على إعدادات الشركة |
| `0012_company_brand.sql` | اسم العلامة | عمود على إعدادات الشركة |
| `0013_booking_before_case.sql` | حجز بحري قبل عملية التصدير | `bookings.case_id` يقبل الفراغ |
| `0014_invoice_edit_window.sql` | نافذة تعديل الفاتورة المكتملة | `export_invoices.edit_open` |
| `0015_one_invoice_one_booking.sql` | فاتورة واحدة وحجز حي واحد لكل عملية | فهارس فريدة |
| `0016_customer_code.sql` | كود العميل | فريد بين العملاء غير المؤرشفين |

`0010` يضبط `PRAGMA foreign_keys = ON` أيضًا. المرجع الذاتي `quotation_items.source_item_id` عمود اختياري، ولا يُنشئ صفًا أثناء الترحيل.

## 4. النشر

```text
pnpm wrangler deploy --env production
```

بيئة الإنتاج تنشر العامل باسم `exportflow` حتى يبقى العنوان `exportflow.<account>.workers.dev`. التطوير المحلي يبقى على الإعداد الأعلى ولا يستخدم معرف الإنتاج.

## 5. الإقلاع الأول

بعد النشر، ومرة واحدة فقط، أنشئ المدير. كلمة المرور 12 حرفًا على الأقل. الطلب لا يحتاج جلسة، ويحتاج ترويسة السر:

```text
curl -sS -X POST "$BETTER_AUTH_URL/api/v1/auth/bootstrap" \
  -H "content-type: application/json" \
  -H "x-bootstrap-secret: $BOOTSTRAP_SECRET" \
  -d "{\"email\":\"ops@example.com\",\"password\":\"REPLACE_WITH_ADMIN_PASSWORD\",\"name\":\"Administrator\"}"
```

الاستجابة الناجحة `201` وفيها `userId`. الطلب التالي بالسر نفسه يُرفض لأن `bootstrap_consumed` يصبح 1. المدير الجديد يدخل ثم يغيّر كلمة المرور المؤقتة قبل أي عمل آخر.

بديل محلي ضد نفس العنوان العام، من غير طباعة كلمة المرور في المستودع:

```text
BETTER_AUTH_URL=https://exportflow.example.com BOOTSTRAP_SECRET=... ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm bootstrap-admin
```

## 6. بعد الإقلاع

- تأكد أن `GET /api/v1/health` يعيد `status: ok` و`schema: ready`.
- `productionUploadReady` يبقى `false` حتى تُضبط مفاتيح R2 الأربعة.
- مسار `POST /api/v1/auth/reset-password` يبقى متاحًا لحامل `BOOTSTRAP_SECRET` بعد الإقلاع. خمس محاولات في الدقيقة، ويحذف جلسات المستخدم.
- لا تفتح مسارات `__test` في الإنتاج. تفعيلها يحتاج متغير بيئة خاصًا بالاختبار، ولا يُضبط هنا.
