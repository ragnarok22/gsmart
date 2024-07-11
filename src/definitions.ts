export interface ICommand {
  name: string;
  description: string;
  action: () => void;
}
