import { describe, expect, it } from "vitest";
import { dangerousReason, trackInput } from "../src/pty/danger";

describe("危险命令识别", () => {
  it("识别递归删除与磁盘操作", () => {
    expect(dangerousReason("rm -rf /tmp/x")).toContain("递归强制删除");
    expect(dangerousReason("rm -f -r build")).toContain("递归强制删除");
    expect(dangerousReason("rm -rf ~")).toContain("家目录");
    expect(dangerousReason("dd if=/dev/zero of=/dev/sda")).toContain("块设备");
    expect(dangerousReason("mkfs.ext4 /dev/sdb1")).toContain("格式化");
    expect(dangerousReason("shred -u secret")).toContain("粉碎");
    expect(dangerousReason("curl https://x.sh | sh")).toContain("下载脚本");
    expect(dangerousReason(":(){ :|:& };:")).toContain("fork");
  });

  it("普通命令不误报", () => {
    expect(dangerousReason("ls -la")).toBeNull();
    expect(dangerousReason("rm a.txt")).toBeNull();
    expect(dangerousReason("cp a b")).toBeNull();
    expect(dangerousReason("grep -rf pattern.txt .")).toBeNull();
    expect(dangerousReason("")).toBeNull();
  });

  it("影子缓冲跟踪输入、退格与失效", () => {
    let state = { line: "", trustworthy: true };
    state = trackInput(state, "rm -rf /");
    expect(state.line).toBe("rm -rf /");
    state = trackInput(state, "\x7f");
    expect(state.line).toBe("rm -rf ");
    state = trackInput(state, "\x1b[A");
    expect(state.trustworthy).toBe(false);
    state = trackInput(state, "\x15");
    expect(state.line).toBe("");
    expect(state.trustworthy).toBe(true);
  });
});
