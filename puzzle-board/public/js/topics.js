// What a photo is about. Chosen on the phone; on the board, pieces with the same topic are tied
// together by thin threads of that colour when the house comes apart.
export const TOPICS = [
  { id: 'people', label: 'People', color: '#ff7ac8' },
  { id: 'animal', label: 'Animals', color: '#ffb347' },
  { id: 'food', label: 'Food', color: '#ff6b6b' },
  { id: 'place', label: 'Places', color: '#6ea8ff' },
  { id: 'nature', label: 'Nature', color: '#7be0a0' },
  { id: 'thing', label: 'Things', color: '#b48cff' },
  { id: 'moment', label: 'Moments', color: '#ffe27a' },
];
export const topicOf = id => TOPICS.find(t => t.id === id) || null;
