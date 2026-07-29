# Age rating questionnaire — documented answers

Answers for the **Apple age-rating questionnaire** and **Google Play content-rating (IARC)
questionnaire**. The app is user-generated-content-driven with 1:1 and group messaging, so
it rates as a mature/17+ social app. Under-13 signup is blocked; under-18 accounts get the
protections in spec §9.

## Apple age-rating questionnaire

| Question | Answer | Note |
|---|---|---|
| Cartoon or Fantasy Violence | None | |
| Realistic Violence | None | |
| Sexual Content or Nudity | **Infrequent/Mild** | UGC photo app; nudity is prohibited by the guidelines and scanned/removed, but user uploads mean residual risk exists. |
| Profanity or Crude Humor | Infrequent/Mild | In user captions/comments/messages. |
| Alcohol, Tobacco, or Drug Use | Infrequent/Mild | May appear in user photos. |
| Mature/Suggestive Themes | Infrequent/Mild | UGC. |
| Horror/Fear, Gambling, Contests | None | No gambling. Points are earned by participation and purchasable to promote content — **not** real-money gambling with prizes. |
| **Unrestricted Web Access** | **No** | No in-app browser to the open web. |
| **User-Generated Content** | **Yes** | Core of the app — photos, video, comments, messaging. |
| Medical/Treatment info | No | |

Because the app has user-generated content and messaging, Apple requires the app to include:
- a way to **report** objectionable content (implemented: report on posts/comments/users/messages),
- a way to **block** abusive users (implemented),
- **filtering/moderation** of objectionable content (implemented: adult + CSAM scan on upload,
  report queue, auto-hide, moderation removals),
- and a published method to **contact** the developer (support email).

These are all present, which is required for approval of a UGC app.

**Resulting Apple rating:** **17+**.

## Google Play content rating (IARC)

- **User-generated content / user interaction:** Yes — users share content and communicate.
- **Shares user location:** Only coarse, opt-in, per-post.
- **Digital purchases:** Yes (points).
- **Violence / sexual content / language:** Mild, via UGC; prohibited and moderated.
- **Gambling:** No.

**Resulting Google rating:** **Mature 17+** (or the IARC regional equivalent), with the
"Users interact" and "Shares info" descriptors.

## Under-18 handling (already enforced)

- Under-13 signup is blocked at the date-of-birth gate.
- Under-18 accounts default to private, and messaging restrictions apply (no stranger DMs;
  message requests only from similar-age users) per spec §9.
- Date of birth is immutable after signup without support intervention.
