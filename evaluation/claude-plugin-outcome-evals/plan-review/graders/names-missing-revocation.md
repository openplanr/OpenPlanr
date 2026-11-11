---
type: regex
target: trace
flags: im
weight: 0.125
arm: both
---
^(?=.*"type":"assistant").*?(?:\b(?:no|nothing|missing|lacks?|without|omits?|never)\b(?!\s+(?:problems?|issues?|concerns?|gaps?|findings?)\b)[^.;:,!?]{0,60}?\brevo(?:ke|kes|king|cation)\b(?![^.;:,!?]{0,40}?\b(?:works?|is (?:covered|handled|fine|planned|done|included)|exists|already)\b)|\brevo(?:ke|kes|king|cation)\b[^.;:,!?]{0,60}?\b(?:is missing|missing|not covered|uncovered|absent|left out|not planned)\b)
