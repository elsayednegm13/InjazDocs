# Checkpoint 02.2 error matrix

Visible copy is localized by stable `error.code`. API `message` is a safe English fallback. SQL, stacks, permission IDs, and object keys must not appear.

| Action | Trigger | API HTTP/code | Arabic visible | English visible | User next action | Test ID | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Add document requirement | Empty type | 422 / DOCUMENT_TYPE_REQUIRED | اختر نوع المستند قبل إضافته. | Choose a document type before adding it. | Select a type | T01, E2E-06 | IMPLEMENTED |
| Add document requirement | Duplicate type | 409 / DOCUMENT_ALREADY_EXISTS | هذا المستند مُضاف بالفعل… | This document is already on the operation… | Open or upload a version | documents service | IMPLEMENTED |
| Add document requirement | Valid new type | 200 | — | — | Row persists after refresh | E2E-06 | IMPLEMENTED |
| Invoice weights | Gross < net | 422 / GROSS_LT_NET | يجب ألا يقل الوزن القائم عن الوزن الصافي. | Gross weight cannot be less than net weight. | Fix weights | E2E-05 | IMPLEMENTED |
| Booking containers | Invalid count | 422 / BOOKING_CONTAINER_COUNT_INVALID | تحقق من عدد الحاويات… | Check the requested container count… | Enter a valid count | bookings service | IMPLEMENTED |
| Sign in | Wrong password | Better Auth 401 → UI only | تعذر تسجيل الدخول | Sign-in failed | Retry credentials | E2E-01 | IMPLEMENTED |
| Session | Unauthenticated API | 401 / SESSION_EXPIRED | انتهت جلستك… | Your session has ended… | Sign in | api wrapper | IMPLEMENTED |
| Permission | Missing grant | 403 / USER_NOT_AUTHORIZED | ليس لديك صلاحية… | You do not have permission… | Ask an admin | E2E-02, actor | IMPLEMENTED |
| Case visibility | Not assigned | 403 / OPERATION_NOT_ACCESSIBLE | لا يمكنك عرض هذه العملية… | You cannot view this operation… | Open an assigned case | actor | IMPLEMENTED |
| File download | Other user's object | 404 | generic inaccessible | generic inaccessible | No key leak | A2 | PRESERVED |
| Public tracking | Missing/revoked token | 410 / CUSTOMER_TRACKING_UNAVAILABLE | رابط المتابعة غير متاح… | This tracking link is unavailable… | Ask the company | T05, E2E-12 | IMPLEMENTED |
| Bank skip | Illegal transition | 409 / BANK_TRANSITION_NOT_ALLOWED | لا يمكن الانتقال لهذه المرحلة… | This step is not available until… | Complete previous stage | E2E-08 | IMPLEMENTED |
| Complete case | Docs not approved | 409 / DOCUMENTS_TRACK_INCOMPLETE | لا يمكن إكمال العملية قبل مراجعة المستندات… | The operation cannot be completed until… | Review documents | E2E-11 | IMPLEMENTED |
| Last admin | Disable sole admin | 409 / LAST_ADMIN | لا يمكن إزالة آخر مدير نشط… | The last active administrator cannot… | Keep one admin | E2E-02 / A3 | IMPLEMENTED |
| Upload | Bad signature | 422 / INVALID_PDF | تعذر قراءة الملف… | The file could not be read… | Choose a valid PDF | uploads | IMPLEMENTED |
| Upload | Incomplete / expired | 409 / DOCUMENT_UPLOAD_INCOMPLETE | لم يكتمل رفع الملف… | The upload did not finish… | Retry or re-choose file | uploads | IMPLEMENTED |
| Rate limit | Public track burst | 429 / TOO_MANY_REQUESTS | تم تنفيذ محاولات كثيرة… | Too many attempts… | Wait | A4 | PRESERVED |
| Unexpected | D1/SQL exception | 500 / SERVER_TEMPORARILY_UNAVAILABLE | تعذر تنفيذ الطلب حاليًا… | The request could not be completed… | Refresh then retry | tests/errors.test.ts | IMPLEMENTED |
| Network | Fetch throw | 0 / NETWORK_UNAVAILABLE | تعذر الاتصال بالخادم… | Could not reach the server… | Check connection; inspect saved data | api.ts | IMPLEMENTED |

Residual: import CSV preview still shows structured preview JSON to staff (commit remains blocked on invalid rows). Live DHL, remote R2 20–400 MiB, and Cloudflare WAF remain owner-deferred.
