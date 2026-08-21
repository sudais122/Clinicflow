const getPeriodStart = (period) => {
  const now = new Date();

  switch (period) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return start;
    }

    case "week": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const day = start.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;

      start.setDate(start.getDate() - diffToMonday);
      return start;
    }

    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      return start;
    }

    case "year": {
      const start = new Date(now.getFullYear(), 0, 1);
      start.setHours(0, 0, 0, 0);
      return start;
    }

    case "all":
    default:
      return null;
  }
};

export { getPeriodStart };