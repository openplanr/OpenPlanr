---
type: regex
target: trace
flags: im
weight: 0.125
arm: both
---
^(?=.*"type":"assistant").*?(?:\b(?:no|nothing|missing|lacks?|without|omits?|never)\b[^.]{0,80}?\brevo(?:ke|kes|king|cation)\b|\brevo(?:ke|kes|king|cation)\b[^.]{0,80}?\b(?:missing|not covered|uncovered|absent|left out|not planned)\b)
