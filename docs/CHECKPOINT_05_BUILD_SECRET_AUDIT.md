# تدقيق أسرار البناء — Checkpoint 05

## المصدر

`@cloudflare/vite-plugin` داخل `generateBundle` يستدعي `getLocalDevVarsForPreview`. إن لم يُعرَّف `secrets` في `wrangler.jsonc` تنسخ Wrangler كل مفاتيح `.dev.vars`. الإضافة تكتب الملف `dist/exportflow/.dev.vars` إن وُجدت قيم.

تعيين `secrets.required` فارغًا كان سيمنع النسخ ويمنع أيضًا تحميل الأسرار في `pnpm dev`. رُفض لأنه يكسر التشغيل المحلي. لا مفتاح موثّق في الإضافة المثبتة يوقف الكتابة مع الإبقاء على التطوير.

## ما نُفّذ

إضافة Vite `exportflow-omit-dev-vars` في `vite.config.ts` بـ `enforce: "post"` تحذف الأصل `.dev.vars` من الحزمة قبل الكتابة. `scripts/build-artifact-guard.mjs` يبقى خطًا ثانيًا ويفشل البناء إن بقي ملف ممنوع أو قيمة مفتاح سري.

## الدليل

بناء هذه الجولة لم يسرد `dist/exportflow/.dev.vars` في قائمة الملفات (بخلاف البناء السابق الذي كان يسرده ثم يحذفه). بعدها: `publishable output is clean: dist`. فحص المسار: الملف غائب من `dist` وموجود في الجذر. `.wrangler` بقي.

الخطر المتبقي: إن تعطلت الإضافتان معًا تعود الكتابة. لا نشر في هذه الجولة، ولا دليل أن نسخة قديمة غادرت الجهاز.
