// frappe-gantt no publica tipos propios. Declaración mínima — solo lo que
// project-gantt.tsx usa realmente (constructor + opciones relevantes).
declare module "frappe-gantt" {
  export interface GanttTaskInput {
    id: string;
    name: string;
    start: string;
    end: string;
    progress?: number;
    dependencies?: string;
    custom_class?: string;
  }

  export interface GanttOptions {
    view_mode?: string;
    language?: string;
    bar_height?: number;
    padding?: number;
    readonly_progress?: boolean;
    readonly_dates?: boolean;
    readonly?: boolean;
    on_date_change?: (task: { id: string }, start: Date, end: Date) => void;
    on_progress_change?: (task: { id: string }, progress: number) => void;
    on_click?: (task: { id: string }) => void;
  }

  export default class Gantt {
    constructor(wrapper: HTMLElement, tasks: GanttTaskInput[], options?: GanttOptions);
  }
}
