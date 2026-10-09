# Sports teaching loop

The authored sports-likes-v1 curriculum has one goal: express a sports preference
with 我喜欢…. Cards/start tips are curriculum, not live model output or an HSKai
completed Mission. The kai-hsk1-v2 persona and kai-reply-v1 policy request short,
patient Chinese/English sentence pairs, a shared length budget, one main question
or task, at most one new teaching point/example, AI identity honesty, student topic
choice and no mastery claims. See [Task 04 policy](short-replies.md).
These are model instructions; compliance still requires content evaluation.

Task 05 adds the `kai-teaching-v1` rule selector: one main action per validated
final student turn, a two-turn teaching cooldown, one clarification before
waiting, and goal suspension after refusal/topic change. Sports and the sample
Mission share a single main likes-expression goal; free chat has no forced
sports target. New-topic expression help does not resume the original goal.
See [natural teaching decisions](natural-teaching.md) for rules and limitations.

Server stages advance from warmup to conversation and then practice, with a
separate closing recommendation and independent paused/clarification state. Only a
validated final student event can add an attempted expression with session, turn,
source event, lesson/rule version and available scaffold provenance. Partials,
teacher text, duplicate final turns and free-chat keywords cannot award progress.
The conservative `sports-expression-attempt-v2` excludes quoted/third-person,
negated and questioned examples. [Task 07](session-summary.md) now adds supported
first-target Mission evidence and free-chat attempts following a sourced,
completed forwarded target reply; ordinary free chat still has zero forced goals.
Choosing a teaching action never creates a learning fact.
No raw transcript is included in stored evidence; no pronunciation score exists.
The browser shows current attempt counts; structured summary data is sent at
ending. Visible summary cards remain Task 08.

Persona/goal context starts with provider session creation. Subsequent changes
are sent at response boundaries and require the exact reviewed version ACK.
An ACK timeout closes the session. The first response after a student final may
still use the previous context; the design avoids a second model on the fast path.
Context application is reported separately from local teaching state.
ACK snapshots retain their own source decision; a later ACK cannot rewrite the
metadata captured when an earlier response-start notice was received. Matching
source turns and ACKs does not prove model compliance or audible delivery.

Local WebSocket/teaching tests validate ownership and rules, not model teaching
quality, short-pause handling or true speech. Real multi-turn account evaluation
must confirm bilingual brevity/order, accurate corresponding English, teaching
density, one-question behavior, topic changes and refusal handling.
