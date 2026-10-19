# المكتبات والتراخيص — Checkpoint 06.6

| المرشح | القرار | السبب |
| --- | --- | --- |
| Tailwind CSS 4 | الإبقاء | `@theme` هو مصدر الرموز |
| Tailwind Plus | غير مستخدم | لا رخصة مثبتة. `NOT_LICENSED` |
| shadcn/ui | لم يُثبَّت | Radix موجود أصلًا في `package.json`. مولّد shadcn يمس CSS والاتجاه ولا حاجة له لمسار واحد |
| Radix | الإبقاء بلا حزم جديدة | الحوارات والقوائم القائمة لم تُستبدل |
| Lucide | الإبقاء | الأيقونات الحالية |
| TanStack Table / Motion | لم تُضف | ملف العملية ليس جدولًا عامًا ولا يحتاج حركة |

`package.json` و`pnpm-lock.yaml` لم يتغيرا في هذه النقطة. الرجوع بإعادة `src/index.css` و`chrome.tsx` و`CasesPages.tsx` و`shell.tsx` وملفات اللغة.
