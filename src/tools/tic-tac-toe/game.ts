// Pure tic-tac-toe rules — no DOM, no network. Both players run the same
// rules on their own copy of the board, so a move only has to carry the
// square index for the two devices to stay in step.

export type Mark = 'X' | 'O';
export type Cell = Mark | null;

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export interface Outcome {
  winner: Mark | null;
  line: readonly number[];
  draw: boolean;
}

export function emptyBoard(): Cell[] {
  return Array(9).fill(null);
}

export function outcome(board: readonly Cell[]): Outcome {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) return { winner: mark, line, draw: false };
  }
  return { winner: null, line: [], draw: board.every(Boolean) };
}

/** X starts round 1, O starts round 2, and so on — nobody always goes first. */
export function starterFor(round: number): Mark {
  return round % 2 === 1 ? 'X' : 'O';
}

/** Whose turn it is: the round's starter, then alternating with each placed mark. */
export function turnFor(board: readonly Cell[], round: number): Mark {
  const placed = board.filter(Boolean).length;
  const starter = starterFor(round);
  return placed % 2 === 0 ? starter : starter === 'X' ? 'O' : 'X';
}
