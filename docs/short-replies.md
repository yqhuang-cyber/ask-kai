# P0 Task 04: short bilingual replies and teaching density

Engineering implemented; actual model compliance and listening calibration are
pending. This task addresses long answers and dense teaching, including the basic
language rule from the supplied Ask Kai persona requirements. It does not claim
that deterministic checks prove teaching quality or real voice acceptance.

## Reply policy

`kai-hsk1-v2` uses the versioned `kai-reply-v1` policy in sports, free conversation
and authorized Mission modes. Session creation and every subsequent context
update include the same policy. Existing ACK, authorization, ownership, safety,
continuous microphone upload and attempted-only evidence rules remain in force.
Authorized `support_language: zh` data cannot replace the P0 bilingual rule.

| Concern | Initial policy |
| --- | --- |
| Language order | Each short Chinese sentence is immediately followed by its corresponding short English sentence, then the next Chinese/English pair |
| Default reply | One sentence pair; at most two pairs when a brief response and follow-up are needed |
| Shared length | At most 36 Han characters, 24 Latin words, 48 combined units, and 180 total Unicode code points including spaces/punctuation |
| Combined units | Han characters + Latin word tokens + numeric groups across the entire reply; both languages consume this budget |
| Questions/tasks | At most one main question or practice task; its English translation counts as the same question |
| Teaching density | Zero new points is valid for ordinary chat; at most one new word or structure and one short example when teaching is needed |
| Examples | Consume the same sentence-pair and length budget; do not add glosses, grammar, pinyin, multiple examples and practice instructions together |
| Long requests | Explain one point briefly, then wait for the learner before continuing |
| English | Convey the preceding Chinese meaning without additional explanations, teaching points or questions |
| Safety | Necessary controlled safety help takes priority over brevity and bilingual style |

These are initial model instructions and observable targets, not a hard audio
cutoff or a measured speech-duration guarantee. The gateway forwards valid
streamed text/audio in the existing order. It does not clip a sentence or cancel
a reply merely for exceeding the budget: doing so could remove the corresponding
English or interrupt a useful answer. Received PCM duration remains separate from
audible duration. Real slow/normal speech must be listened to before tuning these
numbers. No new vendor request field, SDK, extra planning model or secret is needed.

Examples:

- `你喜欢足球吗？ Do you like football?`
- `好呀！ Sure! 你喜欢吃什么？ What do you like to eat?`
- `可以说：我喜欢足球。 You can say: I like football.`

The full persona's word-by-word target-sentence breakdown remains P1 under the
agreed scope. Task 05 adds natural teaching decisions; Task 06 handles playback
and bilingual captions; Tasks 09/10 expand regression and real acceptance.

## Metadata and evaluation

Open `/?diagnostics=1` before starting a reply and export the existing local
experience report. `reply.audit` includes counts, policy version, budget and
surface-language-order flags; `summary.responses[].reply_audit` exposes the same
metadata. Diagnostic export never contains reply text or audio. Collection keeps
at most 4096 code points transiently per observed reply, then clears the buffer at
completion, cancellation or session shutdown. Diagnostics enabled halfway through
a reply do not audit that reply, because its prefix was not collected.

Only completed, nonempty, untruncated received text gets a surface-language-order
result. Cancelled, failed, empty or truncated output has `audit_complete: false`
and no language-order flag in the exported metadata. Received output is not proof
that the learner heard it. Late/foreign/duplicate events are excluded before the
audit; an old cancellation ACK does not affect the newer reply's counts.

The deterministic checks use punctuation, quoted examples and dominant sentence
scripts to detect Chinese/English alternation. Latin proper names inside Chinese
sentences and decimal numbers are supported. Abbreviations, unusual quotation or
punctuation, mixed-language clauses and mismatched translations can require manual
review. A pair of question marks in corresponding Chinese/English sentences is
counted once; punctuation cannot establish that they express the same question,
nor count imperative practice tasks. Counts are lexical proxies, not HSK or audio
measurements. `translation_review_required` and `teaching_density_review_required`
always remain true; no “density passed” flag is inferred from a short answer.

The offline scorer now uses `kai-content-v2`, the same shared budget and separate
language-order counts. The optional LangChain Judge receives semantic criteria
for accurate translation, extra English content, question/task intent, and one
new point/one example. Scores keep their existing ten dimensions and weights;
surface-check flags alone do not prove semantic compliance. The eight authored
demo dialogues are revised to short bilingual examples (`authored-seeds-v2`),
with explicitly synthetic example judgements. They are not observed model replies
or the full Task 09 regression. No live Judge call was made.

## Verification and next local check

- `npm run verify`: policy/budget boundaries, bilingual order, translated questions,
  incomplete/truncated audits, metadata privacy, ownership and context updates.
- `npm run replay`: three synthetic scenarios; no real provider involved.
- `npm run test:browser`: Chromium with synthetic device audio; no live listening.
- Seeduplex synthetic peer verifies the policy reaches `session.create` and
  `session.update`, without claiming supplier adherence.

This task's local results: 123 tests passed, three synthetic replays passed, and
the Chromium synthetic-device/control check passed with zero page errors. CI
runs the same engineering checks on Node 22/24. No real provider or live Judge
was called; actual translation, density and audible brevity remain unaccepted.

For the next real run, use E01/E08 in the diagnostics cases: ordinary feedback,
an English learner answer, a short correction, a request for a detailed explanation,
two proposed Mission targets, and interruption after the Chinese sentence. Listen
for complete Chinese/English pairs and one manageable next step. Compare slow and
normal separately; manually check semantic translation and new-point count.
Keep keys and actual learner recordings/transcripts local. Tasks 09/10 still own
the complete reviewed content regression and device/listening acceptance.
