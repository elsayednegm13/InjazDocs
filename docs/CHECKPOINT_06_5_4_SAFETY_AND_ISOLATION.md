# السلامة والعزل — Checkpoint 06.5.4

## قاعدة المطوّر

قبل أي خادم: `I:\WORK\InjazDocs\.wrangler\state\v3\d1\miniflare-D1DatabaseObject\e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite`

الحجم 638976 بايت. وقت التعديل `2026-10-14T21:07:38.4798993Z`. هذا يطابق ما سُجّل في 06.5.3. لم يُشغَّل منفذ 43173. لم يُكتب هذا المسار.

## ما اشتغل

| العملية | المنفذ | الجذر | سرّ التحميل في السجل |
| --- | --- | --- | --- |
| تفريغ المجدول | 43179 | `.wrangler-0654-drain/state` نسخة من D1 الأداء فقط | `.dev.vars.cp0654drain` |
| سباق القواعد | 43178 | `.wrangler-0654-race/state` بعد ترحيل محلي جديد | `.dev.vars.cp0654` |
| Playwright | 43174 | `.wrangler-e2e` يُمسح عند كل تشغيل | `.dev.vars.e2e` |

السجل قال `No environment found` لاسم `cp0654` و`cp0654drain` ثم `Using secrets defined in` الملف المخصص. لم يظهر سطر تحميل `.dev.vars` وحده. تحذير Wrangler لا يعني سقوطًا إلى أسرار المطوّر.

نسخة التصريف قرأت `.dev.vars` لأن حارس البناء يمرّر `--values .dev.vars` ليمنع نسخ القيم. الحارس أنهى بـ `publishable output is clean: dist`. لم تُطبع القيم.

## ما لم يُمس

لا Git. لا Cloudflare بعيد. لا ترقية قفل. لا `.wrangler/state`. ملفات `.dev.vars.cp0654` و`.dev.vars.cp0654drain` اصطناعية وتُحذف عند الإغلاق. كلمات المرور بقيت في `admin.json` داخل مجلد السباق ولم تُنسخ إلى التقارير.
