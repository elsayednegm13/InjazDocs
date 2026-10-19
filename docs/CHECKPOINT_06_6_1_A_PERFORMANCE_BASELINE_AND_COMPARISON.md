# الأداء — Checkpoint 06.6.1-A

القياس من اختبار اللقطات على Vite المحلي، جلسة مدير أو موظف، بعد ظهور `[data-dossier=loaded]`. عينة واحدة لكل سيناريو، ليست عشر إعادات وليست بناءً منشوراً.

| السيناريو | مللي ثانية حتى الجاهزية |
| --- | --- |
| BANK | 1602 |
| DIRECT | 1421 |
| COMPLETED | 1298 |
| LIMITED | 1628 |

لا p95. لا مقارنة قبل/بعد على نفس العينة. بناء 06.6.1 السابق: CSS 30.54 ك.ب وJS 545.54 ك.ب. لم يُعد البناء في هذه النقطة حتى لا يلمس المسار الافتراضي `.wrangler/state`. `PERFORMANCE_BEFORE_AFTER: PARTIAL`.

الملف الآلي: `docs/qa-screenshots/checkpoint-06-6-1-a/after/evidence-manifest.json`.
