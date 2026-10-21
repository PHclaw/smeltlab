import csv
import math
import random
import traceback
from pathlib import Path

OUT = Path(r"d:/工作/agentflow-master/datacleanr/datacleanr/sample_data/dirty_patients.csv")


def main() -> None:
    random.seed(42)
    surnames = "张王李赵刘陈杨黄周吴徐孙马朱胡林"
    givens = "伟芳娜敏静丽强磊军洋勇杰娟涛明超秀霞平刚桂英"
    depts = ["内科", "外科", "ICU", "心内科"]

    def name():
        n = random.choice(surnames) + random.choice(givens)
        return n + random.choice(givens) if random.random() < 0.4 else n

    def phone():
        head = random.choice(["138", "139", "150", "186"])
        tail = f"{random.randint(0, 99999999):08d}"
        style = random.random()
        if style < 0.55:
            return head + tail
        if style < 0.8:
            return f"{head}-{tail[:4]}-{tail[4:]}"
        return f"{head} {tail[:4]} {tail[4:]}"

    def gender():
        base = random.choice(["男", "女"])
        style = random.random()
        if style < 0.78:
            return base
        if style < 0.86:
            return base + "性"
        if style < 0.91:
            return "M" if base == "男" else "F"
        if style < 0.96:
            return base + " "
        return ""

    def visit_date():
        day = random.randint(1, 28)
        month = random.randint(1, 12)
        style = random.random()
        if style < 0.6:
            return f"2024-{month:02d}-{day:02d}"
        if style < 0.85:
            return f"2024/{month}/{day}"
        if style < 0.98:
            return f"2024年{month}月{day}日"
        return ""

    def dept():
        value = random.choice(depts)
        style = random.random()
        if style < 0.7:
            return value
        if style < 0.82:
            return f" {value}"
        if style < 0.92:
            return f"{value} "
        return value.lower()

    def smoke():
        return random.choices(["无", "有", "未知", "Y", "N"], weights=[48, 33, 9, 5, 5])[0]

    def note():
        return random.choice(["", "复查", "术后恢复良好", "需随访", " 无明显异常 ", "门诊随诊", "建议戒烟"])

    rows = []
    for idx in range(110):
        pid = f"P{idx + 1:04d}"
        base_age = random.randint(20, 88)
        base_bmi = round(random.uniform(17.5, 33.5), 1)
        smoker = smoke()

        for _ in range(random.choices([1, 2, 3], weights=[45, 40, 15])[0]):
            age = base_age + random.choice([0, 0, 0, 1])
            glucose = round(random.uniform(4.0, 13.0), 1)
            sbp = random.randint(95, 185)
            bmi = round(base_bmi + random.uniform(-1.2, 1.2), 1)
            score = (
                -4.4
                + age * 0.032
                + glucose * 0.19
                + (0.55 if sbp >= 150 else 0.0)
                + (0.45 if smoker in ("有", "Y") else 0.0)
                + (0.3 if bmi >= 28 else 0.0)
            )
            target = 1 if random.random() < 1 / (1 + math.exp(-score)) else 0
            cost = round(random.uniform(3000, 45000) + target * random.uniform(5000, 25000), 2)
            out_dept = random.choices(
                ["内科", "外科", "ICU", "康复科"],
                weights=[42 - target * 15, 34, 6 + target * 40, 18],
            )[0]

            rows.append(
                {
                    "患者编号": pid,
                    "姓名": name(),
                    "电话": phone(),
                    "性别": gender(),
                    "年龄": age if random.random() > 0.06 else "",
                    "入院日期": visit_date(),
                    "科室": dept(),
                    "吸烟史": smoker,
                    "BMI": bmi if random.random() > 0.10 else "",
                    "收缩压": sbp if random.random() > 0.07 else "",
                    "血糖": glucose if random.random() > 0.12 else "",
                    "住院费用": cost,
                    "出院科室": out_dept,
                    "并发症": target,
                    "备注": note(),
                }
            )

    n = len(rows)
    for pos, value in zip(random.sample(range(n), 3), [999, -1, 200]):
        rows[pos]["年龄"] = value
    for pos, value in zip(random.sample(range(n), 2), [120.0, 5.0]):
        rows[pos]["BMI"] = value
    for pos in random.sample(range(n), 4):
        rows.append(dict(rows[pos]))
    random.shuffle(rows)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    positive = sum(int(r["并发症"]) for r in rows)
    print(f"rows={len(rows)} cols={len(rows[0])} positive={positive} rate={positive / len(rows):.1%}")


if __name__ == "__main__":
    try:
        main()
        print("OK", OUT.exists(), OUT.stat().st_size if OUT.exists() else 0)
    except Exception:
        traceback.print_exc()
