export type Direction = "north" | "east" | "south" | "west";

export type Start = {
	x: number;
	y: number;
};

export type Command = {
	direction: Direction;
	steps: number;
};

export type EnterPathRequestBody = {
	start: Start;
	commands: Command[];
};

export type ExecutionRecord = {
	id: number;
	timestamp: string;
	commands: number;
	result: number;
	duration: number;
};
