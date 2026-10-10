import { describe, expect, test } from "bun:test";

import { moveTask, sortTasksByOrder } from "../lib/assignments/taskOrder.ts";

const task = (id, order) => ({ id, order, assignment_task_uuid: `task_${id}` });
const ids = (tasks) => tasks.map((t) => t.id);

describe("sortTasksByOrder", () => {
  test("follows the stored order, not creation order", () => {
    expect(ids(sortTasksByOrder([task(1, 2), task(2, 0), task(3, 1)]))).toEqual([2, 3, 1]);
  });

  test("puts unordered legacy rows last, in id order", () => {
    expect(ids(sortTasksByOrder([task(5, null), task(3, undefined), task(9, 0)]))).toEqual([9, 3, 5]);
  });

  test("does not mutate its input and tolerates missing data", () => {
    const input = [task(2, 1), task(1, 0)];
    sortTasksByOrder(input);
    expect(ids(input)).toEqual([2, 1]);
    expect(sortTasksByOrder(undefined)).toEqual([]);
    expect(sortTasksByOrder({ detail: "error" })).toEqual([]);
  });
});

describe("moveTask", () => {
  const tasks = [task(1, 0), task(2, 1), task(3, 2)];

  test("moves a task down and renumbers", () => {
    const moved = moveTask(tasks, 0, 2);
    expect(ids(moved)).toEqual([2, 3, 1]);
    expect(moved.map((t) => t.order)).toEqual([0, 1, 2]);
  });

  test("moves a task up", () => {
    expect(ids(moveTask(tasks, 2, 0))).toEqual([3, 1, 2]);
  });

  test("leaves the original list untouched", () => {
    moveTask(tasks, 0, 2);
    expect(ids(tasks)).toEqual([1, 2, 3]);
    expect(tasks.map((t) => t.order)).toEqual([0, 1, 2]);
  });

  test("ignores an out-of-range source", () => {
    expect(moveTask(tasks, 7, 0)).toBe(tasks);
  });
});
