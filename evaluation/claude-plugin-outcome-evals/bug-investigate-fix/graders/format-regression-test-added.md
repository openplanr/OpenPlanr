---
type: regex
target: trace
arm: both
---
"name":"(?:Write|Edit|MultiEdit)".{0,600}?"file_path":".{0,300}?/test/[^/"]+\.test\.js"
