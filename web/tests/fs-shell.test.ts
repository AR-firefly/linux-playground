import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFs } from "../src/fs/memory";
import { FsShell } from "../src/fs/shell";
import { resolveVirtual } from "../src/fs/types";

function makeShell() {
  const fs = new MemoryFs("测试文件夹");
  fs.load([
    { path: "readme.txt", content: "hello world\n第二行 hello\n" },
    { path: "data.csv", content: "name,score\nAda,98\nLinus,95\n" },
    { path: ".notes", content: "secret\n" },
    { path: "文档/笔记.md", content: "# 笔记\n" },
    {
      path: "文档/长文.txt",
      content: Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行`).join(
        "\n",
      ),
    },
    { path: "练习区/poem.txt", content: "Stay hungry.\n" },
  ]);
  return { fs, shell: new FsShell(fs) };
}

describe("真文件夹模式 · 命令语义", () => {
  let shell: FsShell;
  let fs: MemoryFs;

  beforeEach(() => {
    ({ shell, fs } = makeShell());
  });

  it("pwd / cd / ~ / ..", async () => {
    expect((await shell.execute("pwd")).stdout).toBe("/");
    const cd = await shell.execute("cd 文档");
    expect(cd.exitCode).toBe(0);
    expect(cd.cwd).toBe("/文档");
    expect((await shell.execute("pwd")).stdout).toBe("/文档");
    expect((await shell.execute("cd ..")).cwd).toBe("/");
    await shell.execute("cd 文档");
    expect((await shell.execute("cd ~")).cwd).toBe("/");
    expect((await shell.execute("cd 不存在")).exitCode).toBe(1);
  });

  it("ls 默认隐藏点文件，-a 显示，-l 带权限说明", async () => {
    const plain = await shell.execute("ls");
    expect(plain.stdout).toContain("readme.txt");
    expect(plain.stdout).toContain("文档/");
    expect(plain.stdout).not.toContain(".notes");

    const all = await shell.execute("ls -a");
    expect(all.stdout).toContain(".notes");

    const long = await shell.execute("ls -l");
    expect(long.stdout).toMatch(/-rw-r--r-- 1 you you/);
    expect(long.explanation).toContain("浏览器拿不到真实权限位");
  });

  it("ls -R 递归展开", async () => {
    const result = await shell.execute("ls -R");
    expect(result.stdout).toContain("文档:");
    expect(result.stdout).toContain("笔记.md");
  });

  it("cat 读文件、多文件、报错", async () => {
    expect((await shell.execute("cat readme.txt")).stdout).toContain(
      "hello world",
    );
    expect((await shell.execute("cat readme.txt data.csv")).stdout).toContain(
      "Ada,98",
    );
    expect((await shell.execute("cat 不存在.txt")).exitCode).toBe(1);
    expect((await shell.execute("cat 文档")).stderr).toContain(
      "Is a directory",
    );
    expect((await shell.execute("cat")).exitCode).toBe(1);
  });

  it("mkdir / mkdir -p / touch", async () => {
    expect((await shell.execute("mkdir 新建")).exitCode).toBe(0);
    expect((await shell.execute("mkdir 新建")).exitCode).toBe(1);
    expect((await shell.execute("mkdir 多层/子层")).exitCode).toBe(1);
    expect((await shell.execute("mkdir -p 多层/子层")).exitCode).toBe(0);
    expect((await shell.execute("touch 空.txt")).exitCode).toBe(0);
    const ls = await shell.execute("ls");
    expect(ls.stdout).toContain("空.txt");
  });

  it("echo 重定向 > 与 >> 真实写文件", async () => {
    await shell.execute("echo hello > note.txt");
    expect(await fs.read("/note.txt")).toBe("hello\n");
    await shell.execute("echo again >> note.txt");
    expect(await fs.read("/note.txt")).toBe("hello\nagain\n");
    await shell.execute("echo 覆盖 > note.txt");
    expect(await fs.read("/note.txt")).toBe("覆盖\n");
  });

  it("管道把左侧输出交给右侧", async () => {
    const result = await shell.execute("cat data.csv | grep Ada");
    expect(result.stdout).toBe("Ada,98");
  });

  it("grep -n / -c 与无匹配退出码", async () => {
    expect((await shell.execute("grep -n hello readme.txt")).stdout).toBe(
      "1:hello world\n2:第二行 hello",
    );
    expect((await shell.execute("grep -c hello readme.txt")).stdout).toBe("2");
    const none = await shell.execute("grep zzz readme.txt");
    expect(none.exitCode).toBe(1);
  });

  it("find -name 通配符", async () => {
    const result = await shell.execute('find . -name "*.md"');
    expect(result.stdout).toContain("文档/笔记.md");
    expect(result.stdout).not.toContain("readme.txt");
  });

  it("cp / cp -r / mv", async () => {
    await shell.execute("cp readme.txt copy.txt");
    expect(await fs.read("/copy.txt")).toContain("hello");
    expect((await shell.execute("cp 文档 备份")).exitCode).toBe(1);
    expect((await shell.execute("cp -r 文档 备份")).exitCode).toBe(0);
    await shell.execute("mv copy.txt 练习区/");
    expect(await fs.stat("/练习区/copy.txt")).not.toBeNull();
  });

  it("rm 是软删除：进 .trash，可清空", async () => {
    await shell.execute("rm readme.txt");
    expect(await fs.stat("/readme.txt")).toBeNull();
    const listing = await shell.execute("ls");
    expect(listing.stdout).not.toContain("readme.txt");
    const trash = await fs.list("/.trash");
    expect(trash.length).toBe(1);
    await fs.emptyTrash();
    expect((await fs.list("/.trash")).length).toBe(0);
  });

  it("less 返回分页内容", async () => {
    const result = await shell.execute("less 文档/长文.txt");
    expect(result.pager?.content).toContain("第 1 行");
    expect(result.stdout).toBe("");
  });

  it("chmod / which / whereis 明确指向完整 Linux 模式", async () => {
    expect((await shell.execute("chmod 644 readme.txt")).stderr).toContain(
      "完整 Linux",
    );
    expect((await shell.execute("which ls")).stderr).toContain("完整 Linux");
  });

  it("不在范围外的命令给友好提示", async () => {
    const result = await shell.execute("vim readme.txt");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("此模式暂不支持");
  });
});

describe("真文件夹模式 · 路径与安全", () => {
  it(".. 不能越过所选文件夹根目录", async () => {
    const { shell } = makeShell();
    const result = await shell.execute("cd ../../..");
    expect(result.cwd).toBe("/");
  });

  it("重定向目标与路径同样锚定在根目录内", async () => {
    const { shell, fs } = makeShell();
    await shell.execute("echo x > ../escaped.txt");
    // ../ 在根目录处折叠，落点仍是根内的 /escaped.txt，不会跳出去
    expect(await fs.stat("/escaped.txt")).not.toBeNull();
    expect(resolveVirtual("../escaped.txt", "/")).toBe("/escaped.txt");
  });
});

describe("真文件夹模式 · 复查缺陷回归", () => {
  it("R1 重定向按当前目录解析，不会落到根目录", async () => {
    const { shell, fs } = makeShell();
    await shell.execute("cd 文档");
    await shell.execute("echo 新内容 > note.txt");
    expect(await fs.read("/文档/note.txt")).toBe("新内容\n");
    expect(await fs.stat("/note.txt")).toBeNull();
    await shell.execute("ls 2> err.txt");
    expect(await fs.stat("/文档/err.txt")).not.toBeNull();
  });

  it("R2/R5 rm 回收站等价清空，之后 rm 仍可正常使用", async () => {
    const { shell, fs } = makeShell();
    await shell.execute("rm readme.txt");
    expect((await fs.list("/.trash")).length).toBe(1);
    const cleared = await shell.execute("rm -r .trash");
    expect(cleared.exitCode).toBe(0);
    expect((await fs.list("/.trash")).length).toBe(0);
    expect((await shell.execute("rm data.csv")).exitCode).toBe(0);
    expect(await fs.stat("/data.csv")).toBeNull();
  });

  it("R3 rm -rf / 与 rm -rf . 拒绝删除根目录", async () => {
    const { shell, fs } = makeShell();
    const root = await shell.execute("rm -rf /");
    expect(root.exitCode).toBe(1);
    expect(root.stderr).toContain("root directory");
    const dot = await shell.execute("rm -rf .");
    expect(dot.exitCode).toBe(1);
    expect(await fs.stat("/readme.txt")).not.toBeNull();
  });

  it("R4 mv / cp 到自身子目录被拒绝，内容不丢失", async () => {
    const { shell, fs } = makeShell();
    const mv = await shell.execute("mv 文档 文档/sub");
    expect(mv.exitCode).toBe(1);
    expect(mv.stderr).toContain("subdirectory of itself");
    const cp = await shell.execute("cp -r 文档 文档/sub");
    expect(cp.exitCode).toBe(1);
    expect(cp.stderr).toContain("into itself");
    expect(await fs.stat("/文档/笔记.md")).not.toBeNull();
  });

  it("回收站目录不能被普通命令写入", async () => {
    const { shell, fs } = makeShell();
    const write = await shell.execute("echo evil > .trash/x.txt");
    expect(write.exitCode).toBe(1);
    expect(write.stderr).toContain("回收站");
    expect(await fs.stat("/.trash/x.txt")).toBeNull();
    expect((await shell.execute("mkdir .trash/d")).exitCode).toBe(1);
  });

  it("语义对齐：ls 不存在退出码 2、grep -c 零命中退出 1、mv -f 不支持", async () => {
    const { shell } = makeShell();
    expect((await shell.execute("ls 不存在")).exitCode).toBe(2);
    expect((await shell.execute("grep -c zzz readme.txt")).exitCode).toBe(1);
    const mvFlag = await shell.execute("mv -f readme.txt x.txt");
    expect(mvFlag.exitCode).toBe(1);
    expect(mvFlag.stderr).toContain("暂不支持");
    expect((await shell.execute("rm -f")).exitCode).toBe(0);
    expect((await shell.execute("less a b")).exitCode).toBe(1);
  });

  it("ls -l 的权限提示不会混进管道/重定向输出", async () => {
    const { shell } = makeShell();
    const direct = await shell.execute("ls -l");
    expect(direct.stdout).toContain("浏览器无法读取真实权限位");
    const piped = await shell.execute("ls -l | cat");
    expect(piped.stdout).not.toContain("浏览器无法读取真实权限位");
  });

  it("ls -a 显示 . 与 ..", async () => {
    const { shell } = makeShell();
    const result = await shell.execute("ls -a");
    const lines = result.stdout.split("\n");
    expect(lines).toContain(".");
    expect(lines).toContain("..");
  });
});

describe("真文件夹模式 · 第二轮复查回归", () => {
  it("F1 子目录内 rm/touch/mkdir/cp/mv 都按当前目录解析", async () => {
    const { shell, fs } = makeShell();
    await shell.execute("cd 文档");

    expect((await shell.execute("touch t.txt")).exitCode).toBe(0);
    expect(await fs.stat("/文档/t.txt")).not.toBeNull();
    expect(await fs.stat("/t.txt")).toBeNull();

    expect((await shell.execute("mkdir newdir")).exitCode).toBe(0);
    expect(await fs.stat("/文档/newdir")).not.toBeNull();
    expect(await fs.stat("/newdir")).toBeNull();

    await shell.execute("echo src > src.txt");
    expect((await shell.execute("cp src.txt copy.txt")).exitCode).toBe(0);
    expect(await fs.stat("/文档/copy.txt")).not.toBeNull();
    expect((await shell.execute("mv copy.txt renamed.txt")).exitCode).toBe(0);
    expect(await fs.stat("/文档/renamed.txt")).not.toBeNull();

    expect((await shell.execute("rm 笔记.md")).exitCode).toBe(0);
    expect(await fs.stat("/文档/笔记.md")).toBeNull();
    const trash = await fs.list("/.trash");
    expect(trash.length).toBe(1);
  });

  it("F4 mv 到同名文件被拒绝，不静默覆盖", async () => {
    const { shell, fs } = makeShell();
    const result = await shell.execute("mv 文档 readme.txt");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot overwrite non-directory");
    expect(await fs.read("/readme.txt")).toContain("hello");
  });

  it("F7 子目录里的同名 .trash 目录可见（只有根层隐藏）", async () => {
    const { shell } = makeShell();
    await shell.execute("mkdir -p sub/.trash");
    const listed = await shell.execute("ls -a sub");
    expect(listed.stdout).toContain(".trash");
  });

  it("F8 2>> 给出明确的不支持提示", async () => {
    const { shell } = makeShell();
    const result = await shell.execute("echo hi 2>> log.txt");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("2>>");
  });
});

describe("真文件夹模式 · F3 宽目录与深目录保护", () => {
  it("扁平宽目录超过 2000 项时截断并提示", async () => {
    const fs = new MemoryFs("宽目录");
    const files = Array.from({ length: 2505 }, (_, index) => ({
      path: `f${String(index).padStart(4, "0")}.txt`,
      content: "x",
    }));
    fs.load(files);
    const shell = new FsShell(fs);
    const result = await shell.execute("ls");
    const lines = result.stdout.split("\n");
    expect(lines).toContain("（条目过多，仅显示前 2000 项）");
    expect(lines.length).toBeLessThan(2100);
  });

  it("深目录超过 20 层时停止展开并提示", async () => {
    const fs = new MemoryFs("深目录");
    fs.load([{ path: `${Array.from({ length: 25 }, (_, i) => `l${i}`).join("/")}/deep.txt`, content: "x" }]);
    const shell = new FsShell(fs);
    const result = await shell.execute("ls -R");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("（目录层级过深，已停止继续展开）");
  });
});

describe("真文件夹模式 · F3 边界", () => {
  it("1604 项不应误报截断", async () => {
    const fs = new MemoryFs("中目录");
    fs.load(
      Array.from({ length: 1604 }, (_, index) => ({
        path: `g${String(index).padStart(4, "0")}.txt`,
        content: "x",
      })),
    );
    const shell = new FsShell(fs);
    const result = await shell.execute("ls");
    expect(result.stdout).not.toContain("（条目过多");
  });

  it("恰好 2000 项且仍有未展开目录时要提示", async () => {
    const fs = new MemoryFs("边界");
    const files = Array.from({ length: 1999 }, (_, index) => ({
      path: `h${String(index).padStart(4, "0")}.txt`,
      content: "x",
    }));
    files.push({ path: "sub/a.txt", content: "a" }, { path: "sub/b.txt", content: "b" });
    fs.load(files);
    const shell = new FsShell(fs);
    const result = await shell.execute("ls -R");
    expect(result.stdout).toContain("（条目过多，仅显示前 2000 项）");
  });
});
