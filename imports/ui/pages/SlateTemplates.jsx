import React from 'react';
import { CONSTANTS } from '/imports/api/common/constants.js';
import { DisplaySlates } from '/imports/ui/components/DisplaySlates';

export const SlateTemplates = (props) => {
  return (
    <DisplaySlates type="templates" cols={2} cellHeight={350} slateMinimumPerPage={6} pinSlatePerPageCount="true" showDescription="true" />
  );
}