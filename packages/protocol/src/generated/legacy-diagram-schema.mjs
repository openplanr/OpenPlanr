// Generated from frozen Protocol 1.6 schemas. Do not edit.
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
export const LEGACY_DIAGRAM_DOCUMENT_SCHEMA = deepFreeze({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openplanr.dev/schemas/v1.6.0/diagram-document.schema.json",
  "x-openplanr-contract": {
    "id": "diagram-document",
    "version": "1.6.0"
  },
  "type": "object",
  "additionalProperties": false,
  "required": [
    "kind",
    "schemaVersion",
    "protocolVersion",
    "documentVersion",
    "digestAlgorithm",
    "canonicalization",
    "documentDigest",
    "diagramId",
    "title",
    "summary",
    "audience",
    "grammar",
    "layout",
    "theme",
    "source",
    "nodes",
    "relations",
    "groups",
    "lanes",
    "events",
    "series",
    "axes",
    "sets",
    "annotations",
    "emphasis",
    "accessibility"
  ],
  "properties": {
    "kind": {
      "const": "planr-diagram"
    },
    "schemaVersion": {
      "const": "1.0.0"
    },
    "protocolVersion": {
      "const": "1.6.0"
    },
    "documentVersion": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$"
    },
    "digestAlgorithm": {
      "const": "sha256"
    },
    "canonicalization": {
      "const": "rfc8785"
    },
    "documentDigest": {
      "type": "string",
      "pattern": "^sha256:[0-9a-f]{64}$"
    },
    "diagramId": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
      "maxLength": 128
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 16384,
      "pattern": ".*\\S.*"
    },
    "summary": {
      "type": "string",
      "minLength": 1,
      "maxLength": 16384,
      "pattern": ".*\\S.*"
    },
    "audience": {
      "enum": [
        "engineer",
        "executive",
        "mixed"
      ]
    },
    "grammar": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "version"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
          "minLength": 1,
          "maxLength": 128
        },
        "version": {
          "const": "1.0.0"
        }
      }
    },
    "layout": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "direction",
        "detailTier"
      ],
      "properties": {
        "direction": {
          "enum": [
            "top-down",
            "left-right",
            "right-left",
            "bottom-up",
            "radial"
          ]
        },
        "detailTier": {
          "enum": [
            "simplified",
            "balanced",
            "faithful"
          ]
        }
      }
    },
    "theme": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "themeId",
        "mode"
      ],
      "properties": {
        "themeId": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
          "minLength": 1,
          "maxLength": 128
        },
        "mode": {
          "enum": [
            "light",
            "dark",
            "auto"
          ]
        }
      }
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "format",
        "path",
        "digest"
      ],
      "properties": {
        "format": {
          "enum": [
            "english",
            "mermaid",
            "excalidraw",
            "planr-diagram"
          ]
        },
        "path": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 1024,
              "pattern": "^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//).+$"
            },
            {
              "type": "null"
            }
          ]
        },
        "digest": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^sha256:[0-9a-f]{64}$"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "label",
          "kind"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16384,
            "pattern": ".*\\S.*"
          },
          "kind": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "minLength": 1,
            "maxLength": 128
          },
          "description": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 16384,
                "pattern": ".*\\S.*"
              },
              {
                "type": "null"
              }
            ]
          },
          "semanticPosition": {
            "anyOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "horizontal",
                  "vertical",
                  "meaning"
                ],
                "properties": {
                  "horizontal": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1
                  },
                  "vertical": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1
                  },
                  "meaning": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 16384,
                    "pattern": ".*\\S.*"
                  }
                }
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "minItems": 0,
      "maxItems": 4096
    },
    "relations": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "from",
          "to",
          "kind"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "from": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "to": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "kind": {
            "enum": [
              "association",
              "dependency",
              "flow",
              "message",
              "transition",
              "containment"
            ]
          },
          "label": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 16384,
                "pattern": ".*\\S.*"
              },
              {
                "type": "null"
              }
            ]
          },
          "weight": {
            "anyOf": [
              {
                "type": "number",
                "minimum": 0
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "minItems": 0,
      "maxItems": 8192
    },
    "groups": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "label",
          "members"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16384,
            "pattern": ".*\\S.*"
          },
          "members": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
              "maxLength": 128
            },
            "minItems": 1,
            "maxItems": 256,
            "uniqueItems": true
          }
        }
      },
      "minItems": 0,
      "maxItems": 1024
    },
    "lanes": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "label",
          "members"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16384,
            "pattern": ".*\\S.*"
          },
          "members": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
              "maxLength": 128
            },
            "minItems": 0,
            "maxItems": 256,
            "uniqueItems": true
          }
        }
      },
      "minItems": 0,
      "maxItems": 256
    },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "label",
          "order"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16384,
            "pattern": ".*\\S.*"
          },
          "order": {
            "type": "integer",
            "minimum": 0
          },
          "at": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "minItems": 0,
      "maxItems": 4096
    },
    "series": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "label",
          "values"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16384,
            "pattern": ".*\\S.*"
          },
          "values": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "key",
                "value"
              ],
              "properties": {
                "key": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "value": {
                  "type": "number"
                }
              }
            },
            "minItems": 1,
            "maxItems": 512
          }
        }
      },
      "minItems": 0,
      "maxItems": 256
    },
    "axes": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "label",
          "scale"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16384,
            "pattern": ".*\\S.*"
          },
          "scale": {
            "enum": [
              "categorical",
              "linear",
              "logarithmic",
              "ordinal",
              "temporal"
            ]
          }
        }
      },
      "minItems": 0,
      "maxItems": 16
    },
    "sets": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "label",
          "members"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16384,
            "pattern": ".*\\S.*"
          },
          "members": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
              "maxLength": 128
            },
            "minItems": 1,
            "maxItems": 256,
            "uniqueItems": true
          }
        }
      },
      "minItems": 0,
      "maxItems": 64
    },
    "annotations": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "text",
          "targetId"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16384,
            "pattern": ".*\\S.*"
          },
          "targetId": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
                "maxLength": 128
              },
              {
                "type": "null"
              }
            ]
          }
        }
      },
      "minItems": 0,
      "maxItems": 1024
    },
    "emphasis": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "targetId",
          "level"
        ],
        "properties": {
          "targetId": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "level": {
            "enum": [
              "primary",
              "secondary",
              "muted"
            ]
          }
        }
      },
      "minItems": 0,
      "maxItems": 1024
    },
    "accessibility": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "title",
        "description",
        "readingOrder"
      ],
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 16384,
          "pattern": ".*\\S.*"
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 16384,
          "pattern": ".*\\S.*"
        },
        "readingOrder": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
            "maxLength": 128
          },
          "minItems": 0,
          "maxItems": 4096,
          "uniqueItems": true
        }
      }
    }
  },
  "anyOf": [
    {
      "properties": {
        "nodes": {
          "minItems": 1
        }
      }
    },
    {
      "properties": {
        "relations": {
          "minItems": 1
        }
      }
    },
    {
      "properties": {
        "groups": {
          "minItems": 1
        }
      }
    },
    {
      "properties": {
        "lanes": {
          "minItems": 1
        }
      }
    },
    {
      "properties": {
        "events": {
          "minItems": 1
        }
      }
    },
    {
      "properties": {
        "series": {
          "minItems": 1
        }
      }
    },
    {
      "properties": {
        "axes": {
          "minItems": 1
        }
      }
    },
    {
      "properties": {
        "sets": {
          "minItems": 1
        }
      }
    },
    {
      "properties": {
        "annotations": {
          "minItems": 1
        }
      }
    },
    {
      "properties": {
        "emphasis": {
          "minItems": 1
        }
      }
    }
  ]
});
