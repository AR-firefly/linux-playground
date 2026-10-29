import { describe, expect, it } from "vitest";
import { Shell } from "../src/engine/shell";
import { HOME } from "../src/engine/vfs";

const setup = () => new Shell();

describe("虚拟文件系统与基础导航", () => {
  it("从 /home/player 启动并支持 pwd", () => {
    const shell = setup();
    expect(shell.execute("pwd").stdout).toBe(HOME);
  });

  it("所有预置节点都带完整元数据", () => {
    const shell = setup();
    const stack = [shell.vfs.snapshot()];
    while (stack.length) {
      const node = stack.pop()!;
      expect(node.mode).toBeGreaterThanOrEqual(0);
      expect(node.owner).toBe("player");
      expect(node.group).toBe("player");
      expect(node.size).toBeGreaterThanOrEqual(0);
      expect(node.mtime).toBeGreaterThan(0);
      stack.push(...(node.children || []));
    }
  });

  it("cd 支持相对、绝对、.. 和 ~", () => {
    const shell = setup();
    expect(shell.execute("cd 文档").exitCode).toBe(0);
    expect(shell.execute("pwd").stdout).toBe(`${HOME}/文档`);
    shell.execute("cd ..");
    expect(shell.execute("pwd").stdout).toBe(HOME);
    shell.execute("cd /etc");
    expect(shell.execute("pwd").stdout).toBe("/etc");
    shell.execute("cd ~");
    expect(shell.execute("pwd").stdout).toBe(HOME);
  });

  it("cd 对缺失路径和文件给出贴近 Linux 的错误", () => {
    const shell = setup();
    expect(shell.execute("cd nope").stderr).toContain(
      "No such file or directory",
    );
    expect(shell.execute("cd readme.txt").stderr).toContain("Not a directory");
  });

  it("ls 默认隐藏点文件，-a 显示隐藏文件", () => {
    const shell = setup();
    expect(shell.execute("ls").stdout).not.toContain(".notes");
    expect(shell.execute("ls -a").stdout).toContain(".notes");
    expect(shell.execute("ls -a").stdout.split("\n")).toContain(".");
  });

  it("ls -l 显示权限、属主、大小和时间", () => {
    const shell = setup();
    const output = shell.execute("ls -l readme.txt").stdout;
    expect(output).toMatch(/^-rw-r--r--\s+1 player player\s+\d+/);
    expect(output).toContain("readme.txt");
  });

  it("ls -R 递归列出子目录", () => {
    const shell = setup();
    const output = shell.execute("ls -R").stdout;
    expect(output).toContain("./文档:");
    expect(output).toContain("学习笔记.md");
  });
});

describe("文件读写与目录操作", () => {
  it("cat 读取文件，无参数时给简化版提示", () => {
    const shell = setup();
    expect(shell.execute("cat readme.txt").stdout).toContain(
      "欢迎来到 LinuxPlayground",
    );
    expect(shell.execute("cat").stderr).toContain("简化版暂不支持");
    expect(shell.execute("cat > empty.txt").stderr).toContain("简化版暂不支持");
    expect(shell.vfs.getNode("empty.txt")).toBeNull();
  });

  it("mkdir 默认不补层，-p 自动补层", () => {
    const shell = setup();
    expect(shell.execute("mkdir a/b/c").stderr).toContain(
      "No such file or directory",
    );
    expect(shell.execute("mkdir -p a/b/c").exitCode).toBe(0);
    expect(shell.vfs.getNode("a/b/c")?.type).toBe("directory");
  });

  it("touch 新建空文件，已有文件只更新时间", () => {
    const shell = setup();
    expect(shell.execute("touch new.txt").exitCode).toBe(0);
    const created = shell.vfs.getNode("new.txt");
    expect(created?.type).toBe("file");
    expect(created?.type === "file" && created.content).toBe("");
    const before = created!.mtime;
    created!.mtime = 1;
    shell.execute("touch new.txt");
    expect(shell.vfs.getNode("new.txt")!.mtime).not.toBe(1);
    expect(before).toBeGreaterThan(0);
  });

  it("echo > 清空写，>> 追加写", () => {
    const shell = setup();
    shell.execute("echo 第一行 > note.txt");
    shell.execute("echo 第二行 >> note.txt");
    expect(shell.execute("cat note.txt").stdout).toBe("第一行\n第二行\n");
    shell.execute("echo 重来 > note.txt");
    expect(shell.execute("cat note.txt").stdout).toBe("重来\n");
  });

  it("ls > 文件可保存命令输出", () => {
    const shell = setup();
    expect(shell.execute("ls > listing.txt").stdout).toBe("");
    expect(shell.execute("cat listing.txt").stdout).toContain("readme.txt");
  });

  it("2> 可保存报错，终端不再显示该错误", () => {
    const shell = setup();
    const result = shell.execute("cat missing.txt 2> error.txt");
    expect(result.stderr).toBe("");
    expect(shell.execute("cat error.txt").stdout).toContain(
      "No such file or directory",
    );
  });

  it("cp 复制文件，目录不带 -r 时还原 omitting directory", () => {
    const shell = setup();
    shell.execute("cp readme.txt backup.txt");
    expect(shell.execute("cat backup.txt").stdout).toContain("欢迎来到");
    expect(shell.execute("cp 文档 docs").stderr).toContain(
      "omitting directory",
    );
    expect(shell.execute("cp -r 文档 docs").exitCode).toBe(0);
    expect(shell.execute("cat docs/学习笔记.md").stdout).toContain(
      "Linux 学习笔记",
    );
  });

  it("mv 支持改名与移动", () => {
    const shell = setup();
    shell.execute("mv readme.txt intro.txt");
    expect(shell.vfs.getNode("readme.txt")).toBeNull();
    shell.execute("mv intro.txt 文档");
    expect(shell.execute("cat 文档/intro.txt").stdout).toContain("欢迎来到");
  });

  it("rm 需要 -r 才能删目录，-f 忽略不存在文件", () => {
    const shell = setup();
    expect(shell.execute("rm 文档").stderr).toContain("Is a directory");
    expect(shell.execute("rm -r 文档").exitCode).toBe(0);
    expect(shell.vfs.getNode("文档")).toBeNull();
    expect(shell.execute("rm -f nowhere.txt").exitCode).toBe(0);
  });
});

describe("权限语义", () => {
  it("chmod 数字法与字母法都能修改权限", () => {
    const shell = setup();
    shell.execute("chmod 000 readme.txt");
    expect(shell.execute("ls -l readme.txt").stdout).toMatch(/^----------/);
    expect(shell.execute("cat readme.txt").stderr).toContain(
      "Permission denied",
    );
    shell.execute("chmod u+r readme.txt");
    expect(shell.execute("cat readme.txt").exitCode).toBe(0);
    shell.execute("chmod u-r,g+rw,o-r readme.txt");
    expect(shell.execute("ls -l readme.txt").stdout).toMatch(/^----rw----/);
  });

  it("重定向覆盖已有文件检查 w，新建文件不检查", () => {
    const shell = setup();
    shell.execute("chmod 444 readme.txt");
    expect(shell.execute("echo no > readme.txt").stderr).toContain(
      "Permission denied",
    );
    expect(shell.execute("echo yes > brand-new.txt").exitCode).toBe(0);
  });

  it("cp 与 mv 覆盖已有目标检查 w", () => {
    const shell = setup();
    shell.execute("echo source > source.txt");
    shell.execute("echo target > target.txt");
    shell.execute("chmod 444 target.txt");
    expect(shell.execute("cp source.txt target.txt").stderr).toContain(
      "Permission denied",
    );
    expect(shell.execute("mv source.txt target.txt").stderr).toContain(
      "Permission denied",
    );
  });

  it("rm 不检查文件 w，目录权限不阻止 cd", () => {
    const shell = setup();
    shell.execute("chmod 444 readme.txt");
    expect(shell.execute("rm readme.txt").exitCode).toBe(0);
    shell.execute("chmod 000 文档");
    expect(shell.execute("cd 文档").exitCode).toBe(0);
  });
});

describe("查找、管道与分页", () => {
  it("grep 只做子串匹配，支持 -n 与 -c", () => {
    const shell = setup();
    expect(shell.execute("grep -n Linus data.csv").stdout).toBe("3:Linus,95,B");
    expect(shell.execute("grep -c A data.csv").stdout).toBe("2");
    expect(shell.execute("grep . data.csv").stdout).toBe("");
    expect(shell.execute("grep . data.csv").exitCode).toBe(1);
  });

  it("grep 支持带空格的引号 pattern", () => {
    const shell = setup();
    expect(shell.execute('grep "Stay hungry" 练习区/poem.txt').stdout).toBe(
      "Stay hungry.",
    );
  });

  it("管道把左输出交给右输入", () => {
    const shell = setup();
    expect(shell.execute("ls | grep read").stdout).toBe("readme.txt");
    expect(shell.execute("cat data.csv | grep -c A").stdout).toBe("2");
  });

  it("find 按名称通配符递归查找", () => {
    const shell = setup();
    const output = shell.execute('find . -name "*.txt"').stdout;
    expect(output).toContain("./readme.txt");
    expect(output).toContain("./文档/命令速查.txt");
    expect(output).not.toContain("data.csv");
  });

  it("find 没有匹配时仍正常结束", () => {
    const shell = setup();
    const result = shell.execute('find . -name "*.not-found"');
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("引号中的重定向与管道符号按普通文字处理", () => {
    const shell = setup();
    expect(shell.execute('echo ">"').stdout).toBe(">");
    expect(shell.execute('echo "2>"').stdout).toBe("2>");
    expect(shell.execute('echo "left | right"').stdout).toBe("left | right");
    expect(shell.execute('echo "a > b" > symbols.txt').exitCode).toBe(0);
    expect(shell.execute("cat symbols.txt").stdout).toBe("a > b\n");
  });

  it("which 与 whereis 查询静态路径", () => {
    const shell = setup();
    expect(shell.execute("which ls").stdout).toBe("/usr/bin/ls");
    expect(shell.execute("whereis grep").stdout).toBe("/usr/bin/grep");
    expect(shell.execute("which made-up").exitCode).toBe(1);
  });

  it("less 返回真正的分页会话而不是全文输出", () => {
    const shell = setup();
    const result = shell.execute("less readme.txt");
    expect(result.stdout).toBe("");
    expect(result.pager?.title).toBe("readme.txt");
    expect(result.pager?.content).toContain("欢迎来到");
  });
});

describe("范围控制与重置", () => {
  it.each([
    "ps",
    "ps aux",
    "kill 1",
    "jobs",
    "crontab -l",
    "sudo ls",
    "chown a b",
    "apt install x",
    "vim a",
    "top",
    "ls &",
  ])("%s 返回友好简化提示", (command) => {
    const shell = setup();
    const result = shell.execute(command);
    expect(result.stderr).toContain("简化版暂不支持");
    expect(result.exitCode).not.toBe(0);
  });

  it("未闭合引号不会崩溃", () => {
    const shell = setup();
    expect(shell.execute('echo "hello').stderr).toContain("unmatched quote");
  });

  it("环境重置还原文件、权限和 cwd", () => {
    const shell = setup();
    shell.execute("cd /etc");
    shell.execute("rm -rf /home/player/文档");
    shell.execute("chmod 000 /home/player/readme.txt");
    shell.reset();
    expect(shell.vfs.cwd).toBe(HOME);
    expect(shell.vfs.getNode(`${HOME}/文档`)?.type).toBe("directory");
    expect(shell.execute("cat readme.txt").exitCode).toBe(0);
  });
});
