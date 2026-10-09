# Sports teaching loop

The authored sports-likes-v1 curriculum has one goal: express a sports preference
with 我喜欢…. Cards/start tips are curriculum, not live model output or an HSKai
completed Mission. The kai-hsk1-v2 persona and kai-reply-v1 policy request short,
patient Chinese/English sentence pairs, a shared length budget, one main question
or task, at most one new teaching point/example, AI identity honesty, student topic
choice and no mastery claims. See [Task 04 policy](short-replies.md).
These are model instructions; compliance still requires content evaluation.

Server stages advance from warmup to conversation and then practice. Only a
validated final student event can add an attempted expression with session, turn,
source event, lesson/rule version and available scaffold provenance. Partials,
teacher text, duplicate final turns and free-chat keywords cannot award progress.
No raw transcript is included in stored evidence; no pronunciation score exists.
The browser shows current attempts and a summary when ending normally.

Persona/goal context starts with provider session creation. Subsequent changes
are sent at response boundaries and require the exact reviewed version ACK.
An ACK timeout closes the session. The first response after a student final may
still use the previous context; the design avoids a second model on the fast path.
Context application is reported separately from local teaching state.

Local WebSocket/teaching tests validate ownership and rules, not model teaching
quality, short-pause handling or true speech. Real multi-turn account evaluation
must confirm bilingual brevity/order, accurate corresponding English, teaching
density, one-question behavior, topic changes and refusal handling.
