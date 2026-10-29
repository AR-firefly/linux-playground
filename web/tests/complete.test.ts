import { describe, expect, it } from "vitest";
import { completeCandidates, splitPrefix } from "../src/engine/complete";

describe("补全纯逻辑", () => {
  it("拆分目录部分与前缀", () => {
    expect(splitPrefix("cat re", 6)).toEqual({ dir: "", base: "re" });
    expect(splitPrefix("cat /a/bc", 9)).toEqual({ dir: "/a/", base: "bc" });
    expect(splitPrefix("cd 文档/", 6)).toEqual({ dir: "文档/", base: "" });
  });

  it("按前缀过滤并保持字典序", () => {
    expect(
      completeCandidates("d", ["docs/", "data.csv", "readme.txt"]),
    ).toEqual(["data.csv", "docs/"]);
  });

  it("目录候选以 / 结尾", () => {
    const names = ["文档/", "文档.txt"];
    expect(completeCandidates("文", names)).toEqual(["文档.txt", "文档/"]);
  });

  it("无匹配返回空数组", () => {
    expect(completeCandidates("zzz", ["a", "b"])).toEqual([]);
  });
});
