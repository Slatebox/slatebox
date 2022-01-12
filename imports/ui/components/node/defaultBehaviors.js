function defaultBehaviors (props) {
  return {
    showDelete: {
      title: "Show Delete",
      description: "Allow the delete icon to be shown, even if it's the last node.",
      disabled: props?.node?.options?.showAddAndDeleteConditionally,
      default: true,
      unsetForDisabled: true,
      category: "node",
      col: 4
    },
    showResize: {
      title: "Show Resize",
      description: "Allow the resize icon to be shown",
      default: true,
      unsetForDisabled: true,
      category: "node",
      col: 4
    },
    showRotate: {
      title: "Show Rotate",
      description: "Allow the rotate icon to be shown",
      default: true,
      unsetForDisabled: true,
      category: "node",
      col: 4
    },
    showRelationshipConnector: {
      title: "Show Relationship Connector",
      description: "Allow the relationship connecting icon to be shown",
      default: true,
      unsetForDisabled: true,
      category: "node",
      col: 4
    },
    showRelationshipProperties: {
      title: "Show Properties",
      description: "Allow the relationship properties icon to be shown",
      default: true,
      unsetForDisabled: true,
      category: "relationships",
      col: 4
    },
    showRelationshipReassign: {
      title: "Show Reassign",
      description: "Allow the relationship reassign icon to be shown",
      default: true,
      unsetForDisabled: true,
      category: "relationships",
      col: 4
    },
    showRelationshipDelete: {
      title: "Show Delete",
      description: "Allow the relationship delete icon to be shown",
      default: true,
      unsetForDisabled: true,
      category: "relationships",
      col: 4
    },
    showColorTab: {
      title: "Show Color Tab",
      description: "Show the node's color tab",
      default: true,
      unsetForDisabled: true,
      disabled: props?.node?.options?.disableMenuAsTemplate,
      category: "menu",
      col: 4
    },
    showTextTab: {
      title: "Show Text Tab",
      description: "Show the node's text tab",
      default: true,
      unsetForDisabled: true,
      disabled: props?.node?.options?.disableMenuAsTemplate,
      category: "menu",
      col: 4
    },
    showShapeTab: {
      title: "Show Shape Tab",
      description: "Show the node's shape tab",
      default: true,
      unsetForDisabled: true,
      disabled: props?.node?.options?.disableMenuAsTemplate,
      category: "menu",
      col: 4
    },
    showImageTab: {
      title: "Show Image Tab",
      description: "Show the node's image tab",
      default: true,
      unsetForDisabled: true,
      disabled: props?.node?.options?.disableMenuAsTemplate,
      category: "menu",
      col: 4
    },
    showEffectTab: {
      title: "Show Effect Tab",
      description: "Show the node's effect tab",
      default: true,
      unsetForDisabled: true,
      disabled: props?.node?.options?.disableMenuAsTemplate,
      category: "menu",
      col: 4
    },
    showAdd: {
      title: "Show Add",
      description: "Allow the add icon to be shown",
      disabled: props?.node?.options?.showAddAndDeleteConditionally,
      default: true,
      unsetForDisabled: true,
      category: "node",
      col: 4
    },
    spaceBetweenNodesWhenAdding: {
      description: "Space between nodes:",
      disabled: !props?.node?.options?.showAdd && !props?.node?.options?.showAddAndDeleteConditionally,
      default: 30,
      category: "node",
      col: 12
    },
    showAddAndDeleteConditionally: {
      title: "Conditionally Show Add And Delete",
      description: "Only show the delete or add icon for the most recent copy of this node (You must uncheck both show delete and show add for this to be available).",
      disabled: props?.node?.options?.showDelete || props?.node?.options?.showAdd,
      default: false,
      unsetForDisabled: true,
      category: "node",
      col: 12
    },
    disableDrag: {
      title: "Disable Drag",
      description: "Disable the ability to reposition this node",
      default: false,
      unsetForDisabled: false,
      category: "node",
      col: 6
    },
    disableMenuAsTemplate: {
      title: "Disable Menu In Template",
      description: "Disable the menu when this node is used in a template",
      default: false,
      unsetForDisabled: false,
      category: "menu",
      disabled: props?.node?.options?.showColorTab || props?.node?.options?.showTextTab || props?.node?.options?.showShapeTab || props?.node?.options?.showImageTab || props?.node?.options?.showEffectTab,
      col: 6
    }
  };
}

export default defaultBehaviors;