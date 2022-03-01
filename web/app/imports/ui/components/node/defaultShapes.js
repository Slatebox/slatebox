const defaultShapes = [
  {
    key: 'line',
    name: 'Line',
    path: 'M2,12 L22,12',
  },
  {
    key: 'rect',
    name: 'Rectangle',
    path: 'M3 3h18v18H3z',
  },
  {
    key: 'roundedRect',
    name: 'Rounded Rectangle',
    path: 'M7 4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7z',
  },
  {
    key: 'circle',
    name: 'Circle',
    path: 'M 3 12 a 9.4 9.4 90 1 1 18.8 0 a 9.4 9.4 90 1 1 -18.8 0',
  },
  {
    key: 'star',
    name: 'Star',
    path: 'M16.985 19.501l-.952-5.55 4.033-3.932-5.574-.81L12 4.16 9.508 9.21l-5.574.81 4.033 3.931-.952 5.551L12 16.881l4.985 2.62z',
  },
  {
    key: 'trapeze',
    name: 'Trapeze',
    path: 'M6.649 3.98l-3.2 15.99H20.56l-3.2-15.99H6.65z',
  },
  {
    key: 'triangle',
    name: 'Triangle',
    path: 'M12 4.922L4.197 19h15.606L12 4.922z',
  },
  {
    key: 'rhombus',
    name: 'Rhombus',
    path: 'M12 2.617L2.617 12 12 21.383 21.383 12 12 2.617z',
  },
  {
    key: 'pentagon',
    name: 'Pentagon',
    path: 'M11.976 3.28l-8.791 7.052L6.7 20h10.6l3.515-9.666-8.84-7.053',
  },
  {
    key: 'parallelogram',
    name: 'Parallelogram',
    path: 'M6.463 5L2.544 19h14.993l3.919-14H6.463z',
  },
  {
    key: 'octogon',
    name: 'Octogon',
    path: ' M15.172 4H8.828L4 8.828v6.344L8.828 20h6.344L20 15.172V8.828L15.172 4z',
  },
  {
    key: 'hexagon',
    name: 'Hexagon',
    path: 'M16.817 4H7.183l-4.4 8 4.4 8h9.634l4.4-8-4.4-8',
  },
  {
    key: 'cross',
    name: 'Cross',
    path: 'M15 4H9v5H4v6h5v5h6v-5h5V9h-5V4z',
  },
  {
    key: 'cloud',
    name: 'Cloud',
    path: 'M11.358 4.095c-.592 0-1.157.344-1.512.945L8.96 6.543l-1.638-.6a.783.783 0 0 0-.272-.048c-.521 0-1.021.546-1.021 1.305 0 .064.003.127.01.19l.236 2.033-2.028.282c-.616.086-1.152.744-1.152 1.595 0 .666.333 1.233.798 1.48l1.594.842-.595 1.701a2.65 2.65 0 0 0-.147.877c0 1.312.91 2.305 1.938 2.305.286 0 .56-.073.816-.216l1.81-1.013 1.03 1.8c.304.529.79.829 1.294.829.466 0 .913-.254 1.221-.712l1.196-1.782 1.752 1.238c.24.17.505.256.781.256.826 0 1.572-.814 1.572-1.905l-.001-.061-.037-1.429 1.315-.556c.857-.362 1.473-1.325 1.473-2.454 0-1.218-.717-2.234-1.661-2.523l-1.673-.51.204-1.737c.009-.075.013-.152.013-.23 0-.925-.623-1.605-1.296-1.605-.198 0-.387.055-.564.163l-1.96 1.2-1.014-2.063c-.34-.691-.952-1.1-1.596-1.1z',
  },
  {
    key: 'speech',
    name: 'Speech',
    path: 'M 18.4761 5 H 7.102 C 5.3888 5 4 6.3888 4 8.102 V 13.5307 c 0 1.7132 1.3888 3.102 3.102 3.102 H 13.8297 l 2.803 4.2412 l 0.9018 -4.2412 h 0.9418 c 1.7132 0 3.102 -1.3888 3.102 -3.102 V 8.102 C 21.5781 6.3888 20.1893 5 18.4761 5 z',
  },
  {
    key: 'arrowRight',
    name: 'Right Arrow',
    path: 'M13 4.828V8H4v8h9v3.172L21.172 12 13 4.828z',
  },
  {
    key: 'arrowLeftRight',
    name: 'Right & Left Arrow',
    path: 'M22.586 12L15 4.414V9H9V4.414L1.414 12 9 19.586V15h6v4.586L22.586 12z',
  },
  {
    key: 'arrowLeft',
    name: 'Left Arrow',
    path: 'M11 4.828V8h9v8h-9v3.172L2.828 12 11 4.828z',
  },
]

export default defaultShapes
