export interface EightfoldPosition {
  id: string | number;
  displayJobId?: string | number;
  name?: string;
  locations?: string[];
  department?: string;
  workLocationOption?: string;
  postedTs?: number;
  creationTs?: number;
  positionUrl?: string;
}

export interface EightfoldSearchResponse {
  data?: {
    positions?: EightfoldPosition[];
  };
}
