# سجل القراءة وخط الأساس — Checkpoint 06.6

التاريخ: 17 أكتوبر 2026. الجذر: `I:\WORK\InjazDocs`.

## ما قُرئ

| الملف | ماذا ثبت |
| --- | --- |
| `src/app/router.tsx` | مسار القضية `/export-cases/:id` → `CaseDetailPage` |
| `src/features/cases/CasesPages.tsx` | ملف العملية كان ثمانية أزرار متساوية تخفي الفاتورة والمستندات والحجز |
| `src/components/ui/chrome.tsx` | `DualLane` موجود ويفصل مسار المستندات عن البضاعة |
| `src/components/ui/status.tsx` | الشارة تترجم `status.*` |
| `src/index.css` | Tailwind v4 عبر `@theme`. الخط كان Segoe UI والورق `#f4ead8` |
| `src/app/shell.tsx` | شريط جانبي وLucide. لا وضع ليلي |
| `package.json` | React وRadix وTanStack Query وTailwind 4 موجودة. لا Tailwind Plus |
| `e2e/visual.spec.ts` و`e2e/operations.spec.ts` | الاختبارات تعتمد `data-tab` وزر Complete case |

`server/services/cases.ts` لم يُعد قراءته. يبقى `RECONSTRUCTED_AND_CONTRACT_VERIFIED`. لم تُغيّر عقود الخادم ولا تخفيف 320 مللي ثانية.

## عيوب الواجهة السابقة — OBSERVED من المصدر ولقطات checkpoint-03

1. تبويبات متساوية تخفي المسارين والإجراء التالي داخل نظرة عامة ضعيفة.
2. عنوان صغير فوق اسم المسار (`uppercase tracking`) صعب القراءة.
3. شارة الحالة كانت فوق شريط داكن.
4. لون النحاس `#C38A37` على الورق تباينه 2.81 ولا يصلح لنص.
5. لا وضع ليلي في التطبيق. لم يُخترع.

لقطات سابقة نُسخت إلى `docs/qa-screenshots/checkpoint-06-6/before/` من `checkpoint-03/after`. هي `PRIOR_EVIDENCE` لشكل أقدم، لا تصويرًا جديدًا للكود قبل تعديل هذه النقطة. التصوير الجديد يُلتقط في اختبار المتصفح بعد التعديل.

## مخاطر موروثة تبقى مفتوحة

- تخفيف 320 مللي ثانية محلي فقط. لم يُحذف.
- المجدول ما زال يفحص نحو 100 صفًا بعد انتهاء التسليم.
- سباق القاعدة داخل العامل غير مثبت. `CUSTOM_FOLLOWUP` بلا تعريف. منتصف الليل في القاهرة لإزاحة الساعات لم يُحسم.
