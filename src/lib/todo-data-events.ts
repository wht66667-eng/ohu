export const TODO_DATA_CHANGED_EVENT = 'ohhu-todo-data-changed'
let todoDataRevision = 0

export function getTodoDataRevision() {
  return todoDataRevision
}

export function notifyTodoDataChanged() {
  todoDataRevision++
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TODO_DATA_CHANGED_EVENT))
}
