import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { Text } from "ink";

describe("ink-testing-library harness", () => {
  test("renders text for future Pipeline UI tests", () => {
    const { lastFrame } = render(<Text>agent-cv</Text>);
    expect(lastFrame()).toContain("agent-cv");
  });
});
