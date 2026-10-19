# Checkpoint 06.5 — تقييم مكتبات الواجهة

لم تُثبَّت أي مكتبة جديدة في المنتج. الحكم تاريخه 2026-10-16.

## Tailwind Plus

الحالة: `NOT_AVAILABLE`

لا مجلد Tailwind Plus ولا ملفات Tailwind UI داخل الجذر. Tailwind CSS المثبت (`tailwindcss` ^4.1.14، والإصدار الذي ظهر في بناء الصندوق 4.3.3) إطار تنسيق وليس مجموعة البلوكات التجارية. لا يُنسخ من https://tailwindcss.com/plus ولا من وثائق Elements. الترخيص التجاري موصوف في https://tailwindcss.com/blog/tailwind-plus و https://tailwindcss.com/plus/ui-blocks/documentation/using-html. لا يُطلب مفتاح ترخيص في هذه الدردشة.

Elements غير مقترح: مكوّنات HTML تفاعلية مرخّصة تجارياً وقد تكرر سلوك React الموجود.

## ما هو موجود أصلاً

| القطعة | الحكم | الدليل |
| --- | --- | --- |
| Tailwind CSS 4 | ALREADY_PRESENT | `@import "tailwindcss"` و `@theme` في `src/index.css` |
| Radix | ALREADY_PRESENT كحزم، والاستعمال الفعلي هو `@radix-ui/react-slot` في `button.tsx` فقط. بقية حزم الحوار والقائمة مثبتة وغير مستدعاة من `src` | بحث الاستيراد |
| Lucide | ALREADY_PRESENT | `src/app/shell.tsx` |
| TanStack Query 5 | ALREADY_PRESENT | `src/main.tsx` ينشئ `new QueryClient()` بلا `staleTime`. الافتراضي 0، فكل تركيز يعيد الجلب |
| react-hook-form و zod و `@hookform/resolvers` | ALREADY_PRESENT كحزم. هذه الجولة لم تجد استيراداً لها في `src` ببحث سريع، والنماذج الحالية `FormData` | يحتاج تأكيد أوسع قبل حذفها |
| date-fns | ALREADY_PRESENT كحزمة | لم يُراجع كل الاستدعاءات |
| sonner و cva و clsx و tailwind-merge | ALREADY_PRESENT | الحزم في `package.json` |
| shadcn كحزمة npm | غير مثبت. المكوّنات المحلية أربعة ملفات فقط | `src/components/ui` |
| TanStack Table و React Flow و Motion | غير مثبتة | `package.json` |

## التوصية لـ 06.6 بعد موافقة منفصلة

| الحاجة | الحكم | السبب |
| --- | --- | --- |
| أساس المكوّنات | RECOMMENDED: الإبقاء على Radix عائلة واحدة، وإضافة مكوّنات shadcn كمصدر يُنسخ إلى `src/components/ui` لا كتصميم ثانٍ | shadcn MIT: https://github.com/shadcn-ui/ui/blob/HEAD/LICENSE.md . يدعم Tailwind 4 و React 19: https://ui.shadcn.com/docs/tailwind-v4 . RTL عبر أصناف منطقية: https://ui.shadcn.com/docs/rtl . لا تُضف Base UI أو React Aria فوق Radix |
| الجداول | OPTIONAL: `@tanstack/react-table` لاحقاً للقائمة والحاويات | MIT: https://github.com/TanStack/table/blob/main/LICENSE . الترشيح والترقيم يبقيان على الخادم |
| الجلب | ALREADY_PRESENT: TanStack Query. في 06.6 يُراجع `staleTime` فقط | https://tanstack.com/query/latest/docs/framework/react . لا إطار جلب ثانٍ |
| النماذج | OPTIONAL الإبقاء على التنفيذ الحالي حتى يثبت أن RHF يقلل أخطاء الحقول | الحزم موجودة. لا إضافة |
| الأيقونات | ALREADY_PRESENT: Lucide فقط | لا إيموجي في الملاحة |
| الخط الزمني | RECOMMENDED: الإبقاء على المسارين الحاليين كمكون خفيف | React Flow مرفوض لمسارات الحالة البسيطة: https://reactflow.dev/ ثقيل وتحرير العقد غير مطلوب |
| الحركة | REJECTED كاعتماد جديد | CSS يكفي. `prefers-reduced-motion` عند أي حركة لاحقة |
| الرسوم | OPTIONAL ومؤجل | لا رسم حتى توجد سلسلة زمنية حقيقية غير أعداد اللوحة |
| الخط | RECOMMENDED بعد الموافقة: Noto Sans Arabic أو IBM Plex Sans Arabic ذاتياً، مع Inter أو خط لاتيني واضح | shadcn يذكر Noto مع Inter. OFL يسمح بالتضمين مع إبقاء الرخصة. لا Google Fonts وقت التشغيل. لم يُنزَّل خط في هذه الجولة |
| Tailwind Plus | BLOCKED حتى يبرز المالك رخصة وملفات محلية | لا شراء من هذه الجولة |

Mobbin: المصادقة نجحت ثم أعاد الخادم أن الخطة المدفوعة مطلوبة. لا لقطات تطبيقات خارجية. NOT_AVAILABLE.
