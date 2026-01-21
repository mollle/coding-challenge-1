/** Cardinal direction for robot movement. */
export type Direction = "north" | "east" | "south" | "west";

/** Start coordinate on the integer grid. */
export type Start = {
	x: number;
	y: number;
};

/** A movement instruction: move `steps` vertices in the given direction. */
export type Command = {
	direction: Direction;
	steps: number;
};

/** Request body for the enter-path endpoint. */
export type EnterPathRequestBody = {
	start: Start;
	commands: Command[];
};

/** Execution record as returned by the API and persisted in Postgres. */
export type ExecutionRecord = {
	id: number;
	timestamp: string;
	/** Number of command elements processed. */
	commands: number;
	/** Number of unique vertices cleaned. */
	result: number;
	/** Computation duration in seconds (fractional). */
	duration: number;
};
