import { addVectors } from 'wheel-gestures';
import { Raphael } from '../deps/raphael/raphael.svg.js'
import utils from '../helpers/utils.js';

export default class filters {

  constructor(slate) {
    this.slate = slate;
    this.exposeDefaults();
  }

  /*
  this.slate.paper.def({
    type: "filter",
    id: "displacementFilter",
    inside: [{
      type: "feTurbulence",
      attrs: {
        type: "turbulence",
        baseFrequency: "0.05",
        numOctaves: "5",
        seed: "2",
        result: "turbulence"
      }
    },
    {
      type: "feDisplacementMap",
      attrs: {
        in2: "turbulence",
        in: "SourceGraphic",
        scale: "2"
      }
    }]
  });
  */

  addDeps(deps) {
    const self = this;
    deps.forEach(d => {
      const depDef = {
        id: utils.guid().substring(10),
        tag: d.type,
        ...d.attrs,
        inside: []
      };
      d.nested.forEach(n => {
        depDef.inside.push({
          type: n.type,
          attrs: n.attrs
        })
      });
      self.slate.paper.def(depDef);
    });
  }

  add(filter, isDefault) {
    const self = this;
    const filterDef = {
      id: filter.id || utils.guid().substring(10),
      tag: "filter",
      filterUnits: "userSpaceOnUse",
      ...filter.attrs,
      inside: []
    };
    filter.filters.forEach((filter) => {
      if (filter.nested) {
        filterDef.inside.push({
          type: filter.type,
          nested: filter.nested
        });
      } else {
        filterDef.inside.push({
          type: filter.type,
          attrs: filter.attrs
        });
      }
    });
    self.slate.paper.def(filterDef);
    if (!isDefault) {
      if (!self.slate.customFilters) { self.slate.customFilters = []; }
      self.slate.customFilters.push(filterDef);
    }
    return filter.id;
  }

  remove(id) {
    const self = this;
    self.slate?.filters.splice(self.slate?.filters.findIndex(f => f.id === id));
    return true;
  }

  // <feGaussianBlur in="SourceAlpha" stdDeviation="3"/> <!-- stdDeviation is how much to blur -->
  // <feOffset dx="2" dy="2" result="offsetblur"/> <!-- how much to offset -->
  // <feComponentTransfer>
  //   <feFuncA type="linear" slope="0.5"/> <!-- slope is the opacity of the shadow -->
  // </feComponentTransfer>
  // <feMerge> 
  //   <feMergeNode/> <!-- this contains the offset blurred image -->
  //   <feMergeNode in="SourceGraphic"/> <!-- this contains the element that the filter is applied to -->
  // </feMerge>

  exposeDefaults() {
    const self = this;
    self.availableBackgrounds = [
      {
        name: "Blackboard",
        url: "/images/backgrounds/blackboard.jpg",
        size: "cover"
      },
      {
        name: "Wood",
        url: "/images/backgrounds/wood.png"
      }
    ];
    self.availableFilters = {
      dropShadow: {
        levers: {
          feDropShadow: {
            stdDeviation: { label: "distance", default: 1.5, range: [1, 10] },
            dx: { label: "x-displacement", default: 5, range: [1, 50] },
            dy: { label: "y-displacement", default: 5, range: [1, 50] }
          }
        },
        types: ["vect", "line", "image", "text"],
        filters: [
          {
            type: "feGaussianBlur",
            attrs: {
              stdDeviation: "3",
              in: "SourceAlpha",
            }
          },
          {
            type: "feOffset",
            attrs: {
              dx: "5",
              dy: "5",
              result: "offsetblur"
            }
          },
          {
            type: "feComponentTransfer",
            nested: [
              {
                type: "feFuncA",
                attrs: {
                  type: "linear",
                  slope: "0.8"
                }
              }
            ]
          },
          {
            type: "feMerge",
            nested: [
              {
                type: "feMergeNode",
                attrs: {}
              },
              {
                type: "feMergeNode",
                attrs: {
                  in: "SourceGraphic"
                }
              }
            ]
          }
        ]
      },
      // , relief: {
      //   types: ["vect", "line", "text"],
      //   filters: {
      //     feColorMatrix: {
      //       in: "SourceGraphic",
      //       type: "luminanceToAlpha",
      //       result: "LUMINANCE"
      //     },
      //     feDiffuseLighting: {
      //       in: "LUMINANCE",
      //       surfaceScale: "10",
      //       result: "LIGHTING",
      //       inside: [{
      //         feDistantLight: {
      //           azimuth: "90",
      //           elevation: "28"
      //         }
      //       }]
      //     },
      //     feComposite: {
      //       in:"LIGHTING",
      //       in2:"SourceGraphic",
      //       operator: "in"
      //     }
      //   }
      // }
      // , wood: {
      //   backgroundColor: "#EBAE6E",
      //   types: ["slate"],
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs:{ type: "fractalNoise", baseFrequency: ".1 .01" }
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: {
      //         values:  `0 0 0 .11 .69
      //                   0 0 0 .09 .38
      //                   0 0 0 .08 .14
      //                   0 0 0 0 1`
      //       }
      //     }
      //   ]
      // }
      // , starrySky: {
      //   types: ["slate"],
      //   backgroundColor: "#000",
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs:{ baseFrequency: "0.2" }
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: {
      //         values:  `0 0 0 9 -4
      //                   0 0 0 9 -4
      //                   0 0 0 9 -4
      //                   0 0 0 0 1`
      //       }
      //     }
      //   ]
      // },
      // dalmation: {
      //   backgroundColor: "#fff",
      //   types: ["slate"],
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: { 
      //         type: "fractalNoise"
      //         , baseFrequency: "0.006"
      //         , numOctaves:"2" 
      //       }
      //     },
      //     {
      //       type: "feComponentTransfer",
      //       attrs: {},
      //       nested: [
      //         {
      //           type: "feFuncA",
      //           attrs: {
      //             type: "discrete", 
      //             tableValues: "0 1 0"
      //           }
      //         }
      //       ]
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: {
      //         values: `0 0 0 1 0
      //                  0 0 0 1 0
      //                  0 0 0 1 0
      //                  0 0 0 0 1`
      //       }
      //     }
      //   ]
      // },
      // camo: {
      //   types: ["slate"],
      //   backgroundColor: "#44734B",
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: { type: "fractalNoise", baseFrequency: "0.02", numOctaves: "3" }
      //     },
      //     {
      //       type: "feComponentTransfer",
      //       nested: {
      //         feFuncR: {
      //           type: "discrete",
      //           tableValues: "0 0 0 0 1 1"
      //         },
      //         feFuncG: {
      //           type: "discrete",
      //           tableValues: "0 0 0 1 1"
      //         },
      //         feFuncB: {
      //           type: "discrete",
      //           tableValues: "0 1"
      //         }
      //       }
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: {
      //         values: `1  0 0 0 0
      //         -1  1 0 0 0
      //         -1 -1 1 0 0
      //          0  0 0 0 1`
      //       }
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: {
      //         values: `-0.08  0.42  0.09 0 0.08
      //         -0.17  0.35 -0.08 0 0.17
      //         -0.08  0.15 -0.04 0 0.08
      //          0    0     0    0 1`
      //       }
      //     }
      //   ]
      // },
      // paper: {
      //   types: ["slate"],
      //   backgroundColor: "#CDCDCD",
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: {
      //         type: "fractalNoise", baseFrequency: "0.04", numOctaves: "5", result: "noise"
      //       }
      //     },
      //     {
      //       type: "feDiffuseLighting",
      //       attrs: {
      //         in: "noise", "lighting-color": "white", surfaceScale: "2", result: "diffLight"
      //       },
      //       nested: [
      //         {
      //           type: "feDistantLight",
      //           attrs: {
      //             azimuth:"45", elevation:"35"
      //           }
      //         }
      //       ]
      //     }
      //   ]
      // },
      // molten: {
      //   types: ["slate"],
      //   backgroundColor: "#CDCDCD",
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: {
      //         baseFrequency: "0.02"
      //       }
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: {
      //         values:`0 0 0 0 .47
      //                 0 0 0 0 .35
      //                 0 0 0 0 .21
      //                 0 0 0 -240 30`
      //       }
      //     },
      //     {
      //       type: "feDropShadow",
      //       attrs: {
      //         dx: "0", dy: "0"
      //       }
      //     },
      //     {
      //       type: "feDropShadow",
      //       attrs: {
      //         dx: "6", dy:"6", stdDeviation: "6"
      //       }
      //     },
      //     {
      //       type: "feBlend",
      //       attrs: {
      //         in:"SourceGraphic"
      //       }
      //     }
      //   ]
      // },
      // topo: {
      //   types: ["slate"],
      //   backgroundColor: "#fff",
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: {
      //         baseFrequency:".005", numOctaves: "5"
      //       }
      //     },
      //     {
      //       type: "feComponentTransfer",
      //       attrs: {},
      //       nested: {
      //         feFuncA: {
      //           type: "discrete", tableValues: "1 0 1 0 1 0 1 0 1 0"
      //         }
      //       }
      //     },
      //     {
      //       type: "feConvolveMatrix",
      //       attrs: {
      //         kernelMatrix: `1 0 1
      //                       0 -4 0
      //                       1 0 1`
      //       }
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: {
      //         values:`0 0 0 -1 1
      //                 0 0 0 -1 1
      //                 0 0 0 -1 1
      //                 0 0 0  0 1`
      //       }
      //     }
      //   ]
      // },
      // clouds: {
      //   types: ["slate"],
      //   backgroundColor: "#4C6E95",
      //   fill: "cloudGradient",
      //   deps: [
      //     {
      //       type: "linearGradient",
      //       attrs: {
      //         id: "cloudGradient"
      //       },
      //       nested: [
      //         {
      //           type: "stop",
      //           attrs: {
      //             "stop-color": "#579"
      //           }
      //         },
      //         {
      //           type: "stop",
      //           attrs: {
      //             offset: "1", "stop-color": "#248"
      //           }
      //         }
      //       ]
      //     }
      //   ],
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: {
      //         type: "fractalNoise", baseFrequency: ".008 .01", numOctaves: "5"
      //       }
      //     },
      //     {
      //       type: "feComponentTransfer",
      //       attrs: {},
      //       nested: {
      //         feFuncA: {
      //           type: "gamma", exponent: "1.1"
      //         }
      //       }
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: {
      //         values: `0 0 0 0 1
      //         0 0 0 0 1
      //         0 0 0 0 1
      //         0 0 0 -1 .5`
      //       }
      //     },
      //     {
      //       type: "feBlend",
      //       attrs: {
      //         in2: "SourceGraphic"
      //       }
      //     }
      //   ]
      // },
      // watermelon: {
      //   types: ["slate"],
      //   backgroundColor: "#3D812C",
      //   fill: "watermelonPattern",
      //   deps: [
      //     {
      //       type: "pattern",
      //       attrs: {
      //         id: "watermelonPattern", width: "80", height: "1", patternUnits: "userSpaceOnUse"
      //       },
      //       nested: [
      //         {
      //           type: "circle",
      //           attrs: {
      //             r: "99",
      //             fill: "#3f812d"
      //           }
      //         },
      //         {
      //           type: "path",
      //           attrs: {
      //             d: "M0 0H32V1H0Z", "fill": "#96c96d"
      //           }
      //         }
      //       ]
      //     }
      //   ],
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: { type: "fractalNoise", baseFrequency: ".02", numOctaves: "3" }
      //     },
      //     {
      //       type: "feDisplacementMap",
      //       attrs: { in: "SourceGraphic", scale: "48" }
      //     }
      //   ]
      // },
      // zebra: {
      //   types: ["slate"],
      //   backgroundColor: "#fff",
      //   fill: "zebraGradient",
      //   deps: [
      //     {
      //       type: "linearGradient",
      //       attrs: {
      //         id: "zebraGradient", x2: "50", spreadMethod: "reflect", gradientUnits: "userSpaceOnUse"
      //       },
      //       nested: [
      //         {
      //           type: "stop",
      //           attrs: {
      //             offset: "50%"
      //           }
      //         },
      //         {
      //           type: "stop",
      //           attrs: {
      //             offset: "50%", "stop-color": "#fff"
      //           }
      //         }
      //       ]
      //     }
      //   ],
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: {
      //         baseFrequency: ".005", numOctaves: "5"
      //       }
      //     },
      //     {
      //       type: "feGaussianBlur",
      //       attrs: { stdDeviation: "1" }
      //     },
      //     {
      //       type: "feDisplacementMap",
      //       attrs: {
      //         in: "SourceGraphic", scale: "40"
      //       }
      //     }
      //   ]
      // },
      // moss: {
      //   types: ["slate"],
      //   backgroundColor: "#2E570F",
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: {
      //         type: "fractalNoise", baseFrequency: ".02", numOctaves: "4"
      //       }
      //     },
      //     {
      //       type: "feMorphology",
      //       attrs: {
      //         radius: "1", operator: "dilate"
      //       }
      //     },
      //     {
      //       type: "feConvolveMatrix",
      //       attrs: {
      //         kernelMatrix: `1 1 1
      //                       1 2 1
      //                       1 -9 1`,
      //         preserveAlpha: "true"
      //       }
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: { 
      //         values: `.4 .8 .6 0 0
      //                   1 1 1 0 0
      //                   .1 .2 .3 0 0
      //                   0 0 0 0 1`
      //       }
      //     },
      //     {
      //       type: "feGaussianBlur",
      //       attrs: {
      //         stdDeviation: ".5"
      //       }
      //     }
      //   ]
      // },
      // grass: {
      //   types: ["slate"],
      //   backgroundColor: "#009600",
      //   fill: "grassPattern",
      //   deps: [
      //     {
      //       type: "pattern",
      //       attrs: {
      //         id: "grassPattern",
      //         width: ".1",
      //         height: ".1"
      //       },
      //       nested: [
      //         {
      //           type: "rect",
      //           attrs: {
      //             widtth: "5%",
      //             height: "10%"
      //           }
      //         }
      //       ]
      //     }
      //   ],
      //   filters: [
      //     {
      //       type: "feTurbulence",
      //       attrs: { type: "fractalNoise", baseFrequency: ".8" }
      //     },
      //     {
      //       type: "feMorphology",
      //       attrs: { operator: "dilate", radius: "1" }
      //     },
      //     {
      //       type: "feConvolveMatrix",
      //       attrs: { 
      //         kernelMatrix: `1 1 1
      //                       -8 1 1
      //                       1 1 1`
      //         , preserveAlpha: "true" }
      //     },
      //     {
      //       type: "feBlend",
      //       attrs: { 
      //         in2: "SourceGraphic"
      //       }
      //     },
      //     {
      //       type: "feMorphology",
      //       attrs: { 
      //         operator: "dilate",
      //         radius: ".1 2"
      //       }
      //     },
      //     {
      //       type: "feColorMatrix",
      //       attrs: { 
      //         values: `.05 0 0 0 0
      //                 .3 0 .1 -.1 .1
      //                 0 0 0 0 0
      //                 0 0 0 0 1`
      //       }
      //     }
      //   ]
      // },
      // extruded: {
      //   types: ["vect", "line", "image", "text"],
      //   filters: [
      //     {
      //       type: "feConvolveMatrix",
      //       attrs: {
      //         in: "SourceAlpha",
      //         order: "4,4",
      //         kernelMatrix:
      //           `1 0 0 0,
      //           0 1 0 0,
      //           0 0 1 0,
      //           0 0 0 1`,
      //         divisor: "4",
      //         result: "BEVEL"
      //       }
      //     },
      //     {
      //       type: "feOffset",
      //       attrs: {
      //         in: "BEVEL",
      //         dx: "2",
      //         dy: "2",
      //         result: "OFFSET"
      //       }
      //     },
      //     {
      //       type: "feMerge",
      //       nested: [
      //         {
      //           type: "feMergeNode",
      //           attrs: {
      //             in: "OFFSET"
      //           }
      //         },
      //         {
      //           type: "feMergeNode",
      //           attrs: {
      //             in: "SourceGraphic"
      //           }
      //         }
      //       ]
      //     }
      //   ]
      // },
      postItNote: {
        types: ["vect", "line", "image", "text"],
        filters: [
          {
            type: "feGaussianBlur",
            attrs: {
              stdDeviation: "2",
              in: "SourceAlpha",
            }
          },
          {
            type: "feOffset",
            attrs: {
              dx: "0",
              dy: "4",
              result: "offsetblur"
            }
          },
          {
            type: "feComponentTransfer",
            nested: [
              {
                type: "feFuncA",
                attrs: {
                  type: "linear",
                  slope: "0.5"
                }
              }
            ]
          },
          {
            type: "feMerge",
            nested: [
              {
                type: "feMergeNode",
                attrs: {}
              },
              {
                type: "feMergeNode",
                attrs: {
                  in: "SourceGraphic"
                }
              }
            ]
          }
          // feDropShadow: {
          //   stdDeviation: "1.5",
          //   in: "SourceGraphic",
          //   dx: "5",
          //   dy: "5",
          //   "flood-color": "#000",
          //   "flood-opacity": "0.7"
          // }
        ]
      }
      , tattered: {
        levers: {
          feDisplacementMap: {
            scale: { label: "torn", default: "10", range: [2, 50] }
          }
        },
        types: ["vect", "line", "image", "text"],
        filters: [
          {
            type: "feTurbulence",
            attrs: {
              type: "turbulence",
              baseFrequency: ".05 .05",
              numOctaves: "05",
              seed: "2",
              stitchTiles: "noStitch",
              result: "turbulence"
            }
          },
          {
            type: "feDisplacementMap",
            attrs: {
              in: "SourceGraphic",
              in2: "turbulence",
              scale: "10",
              xChannelSelector: "R",
              yChannelSelector: "B",
              result: "displacementMap"
            }
          }
        ]
      },
      blur: {
        levers: {
          feGaussianBlur: {
            stdDeviation: { label: "displacement", default: 2, range: [1, 10] }
          }
        },
        types: ["vect", "line", "image", "text"],
        filters: [
          {
            type: "feGaussianBlur",
            attrs: {
              stdDeviation: "2",
              in: "SourceGraphic",
              edgeMode: "none",
            }
          }
        ]
      },
      outline: {
        levers: {
          feMorphology: {
            radius: { label: "cutout", default: "1", range: [1, 10] }
          }
        },
        types: ["text", "line"],
        filters: [
          {
            type: "feMorphology",
            attrs: {
              operator: "dilate",
              radius: "1",
              in: "SourceGraphic",
              result: "thickness"
            }
          },
          {
            type: "feComposite",
            attrs: {
              operator: "out",
              in: "thickness",
              in2: "SourceGraphic"
            }
          }
        ]
      },
      pixelate: {
        levers: {
          feImage: {
            width: { label: "width", default: "8", range: [1, 30] },
            height: { label: "height", default: "8", range: [1, 30] }
          }
        },
        types: ["image"],
        filters: [
          //https://stackoverflow.com/questions/37451189/can-one-pixelate-images-with-an-svg-filter
          {
            type: "feGaussianBlur",
            attrs: {
              stdDeviation: "2",
              in: "SourceGraphic",
              result: "smoothed"
            }
          },
          {
            type: "feImage",
            attrs: {
              width: "8",
              height: "8",
              "xlink:href": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAIAAAACDbGyAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAWSURBVAgdY1ywgOEDAwKxgJhIgFQ+AP/vCNK2s+8LAAAAAElFTkSuQmCC",
              result: "displacement-map"
            }
          },
          {
            type: "feTile",
            attrs: {
              in: "displacement-map",
              result: "pixelate-map"
            }
          },
          {
            type: "feDisplacementMap",
            attrs: {
              in: "smoothed",
              in2: "pixelate-map",
              xChannelSelector: "R",
              yChannelSelector: "G",
              scale: "30",
              result: "pre-final"
            }
          },
          {
            type: "feComposite",
            attrs: {
              operator: "in",
              in2: "SourceGraphic"
            }
          }
        ]
      },
      posterize: {
        levers: {

        },
        types: ["image"],
        filters: [
          {
            type: "feComponentTransfer",
            nested: {
              feFuncR: {
                type: "discrete",
                tableValues: ".25 .4 .5 .75 1"
              },
              feFuncG: {
                type: "discrete",
                tableValues: ".25 .4 .5 .75 1"
              },
              feFuncB: {
                type: "discrete",
                tableValues: ".25 .4 .5 .75 1"
              }
            }
          }
        ]
      },
      pencil: {
        // https://heredragonsabound.blogspot.com/2020/02/creating-pencil-effect-in-svg.html
        levers: {}
        , types: ["vect", "line", "text", "image"]
        , filters: [
          {
            type: "feTurbulence",
            attrs: { type: "fractalNoise", baseFrequency: "0.03", numOctaves: "3", seed: "1", result: "f1" }
          },
          {
            type: "feDisplacementMap",
            attrs: { xChannelSelector: "R", yChannelSelector: "G", scale: "5", in: "SourceGraphic", in2: "f1", result: "f4" }
          },
          {
            type: "feTurbulence",
            attrs: { type: "fractalNoise", baseFrequency: "0.03", numOctaves: "3", seed: "10", result: "f2" }
          },
          {
            type: "feDisplacementMap",
            attrs: { xChannelSelector: "R", yChannelSelector: "G", scale: "5", in: "SourceGraphic", in2: "f2", result: "f5" }
          },
          {
            type: "feTurbulence",
            attrs: { type: "fractalNoise", baseFrequency: "1.2", numOctaves: "2", seed: "100", result: "f3" }
          },
          {
            type: "feDisplacementMap",
            attrs: { xChannelSelector: "R", yChannelSelector: "G", scale: "3", in: "SourceGraphic", in2: "f3", result: "f6" }
          },
          {
            type: "feBlend",
            attrs: { mode: "multiply", in2: "f4", in: "f5", result: "out1" }
          },
          {
            type: "feBlend",
            attrs: { mode: "multiply", in: "out1", in2: "f6", result: "out2" }
          }
        ]
      }
    }
  }
}

  // <filter id="f1" x="0" y="0" width="200%" height="200%">
  //   <feOffset result="offOut" in="SourceGraphic" dx="20" dy="20" />
  //   <feBlend in="SourceGraphic" in2="offOut" mode="normal" />
  // </filter>

  // <feBlend>
  // <feColorMatrix>
  // <feComponentTransfer>
  // <feComposite>
  // <feConvolveMatrix>
  // <feDiffuseLighting>
  // <feDisplacementMap>
  // <feDropShadow>
  // <feFlood>
  // <feGaussianBlur>
  // <feImage>
  // <feMerge>
  // <feMorphology>
  // <feOffset>
  // <feSpecularLighting>
  // <feTile>
  // <feTurbulence></feTurbulence>

  //https://github.com/svgdotjs/svg.filter.js

  // <filter id="displacementFilter">
  //   <feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="5" seed="2" result="turbulence"/>
  //   <feDisplacementMap in2="turbulence" in="SourceGraphic" scale="2"/>
  // </filter>