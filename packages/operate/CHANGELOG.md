# @openplanr/operate

## 0.1.20

### Patch Changes

- Updated dependencies [9d60c2d]
  - @openplanr/protocol@0.13.0

## 0.1.19

### Patch Changes

- Updated dependencies [0b4992c]
  - @openplanr/protocol@0.12.0

## 0.1.18

### Patch Changes

- 625c09f: Drop Node.js 20, which reached end of life in April 2026. This is a breaking CLI change: `openplanr` now requires Node.js `^22.13.0 || >=23.5.0`, and the pipeline and Protocol require Node.js 22.13.0 or later.
  
  Run `node -v` to check your version. If it reports v20, or a 22 release below 22.13, install Node.js 24 LTS or Node.js 22.13 or later, then rerun the installer or `npm install --global openplanr`.
  
  On Node.js 20 the install scripts stop before installing anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found v20.x.y.` `npm install --global openplanr` only warns about the engines range, and `openplanr` then stops before loading anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found 20.x.y.` `openplanr-pipeline doctor` fails its Node.js check with `Node 20.x.y does not satisfy engines.node >=22.13.0`, and the delegate skill's probe reports that Node 22 or later is required.
- Updated dependencies [625c09f]
- Updated dependencies [50fb215]
- Updated dependencies [2ed98ac]
  - @openplanr/protocol@0.11.0

## 0.1.17

### Patch Changes

- Updated dependencies [ac4c5c4]
- Updated dependencies [96f616b]
- Updated dependencies [ac4c5c4]
- Updated dependencies [ac4c5c4]
- Updated dependencies [d2ef7a8]
  - @openplanr/protocol@0.10.3

## 0.1.16

### Patch Changes

- Updated dependencies [9557ccf]
- Updated dependencies [d4f1cc8]
- Updated dependencies [28bee48]
- Updated dependencies [d4f1cc8]
  - @openplanr/protocol@0.10.2

## 0.1.15

### Patch Changes

- Updated dependencies [5c51ad8]
  - @openplanr/protocol@0.10.1

## 0.1.14

### Patch Changes

- Updated dependencies [db8c0b9]
  - @openplanr/protocol@0.10.0

## 0.1.13

### Patch Changes

- Updated dependencies [390d731]
- Updated dependencies [f27d487]
- Updated dependencies [036f395]
  - @openplanr/protocol@0.9.0

## 0.1.12
### Patch Changes

- Updated dependencies [76ef9b3]
  - @openplanr/protocol@0.8.0

## 0.1.11
### Patch Changes

- Updated dependencies [496cd13]
  - @openplanr/protocol@0.7.3

## 0.1.10
### Patch Changes

- Updated dependencies [74fd3a5]
- Updated dependencies [b6a77c6]
  - @openplanr/protocol@0.7.2

## 0.1.9
### Patch Changes

- Updated dependencies [ec8b895]
  - @openplanr/protocol@0.7.1

## 0.1.8
### Patch Changes

- Updated dependencies [c7c15dc]
- Updated dependencies [c373710]
- Updated dependencies [c8ef5f5]
- Updated dependencies [2d3aa3f]
- Updated dependencies [504bce4]
- Updated dependencies [711e17f]
  - @openplanr/protocol@0.7.0

## 0.1.7
### Patch Changes

- Updated dependencies [4ce826e]
  - @openplanr/protocol@0.6.2

## 0.1.6
### Patch Changes

- Updated dependencies [3bcf955]
- Updated dependencies [3bcf955]
  - @openplanr/protocol@0.6.1

## 0.1.5
### Patch Changes

- Updated dependencies [4ae7379]
- Updated dependencies [d314fa2]
  - @openplanr/protocol@0.6.0

## 0.1.4
### Patch Changes

- Updated dependencies [6508d23]
  - @openplanr/protocol@0.5.0

## 0.1.3
### Patch Changes

- Updated dependencies [f93a973]
  - @openplanr/protocol@0.4.0

## 0.1.2
### Patch Changes

- Updated dependencies [7c0e86d]
  - @openplanr/protocol@0.3.0

## 0.1.1
### Patch Changes

- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
  - @openplanr/protocol@0.2.0
