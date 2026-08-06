import { Counter } from "../../models/counter.models.js";

/**
 *
 * @param {string} name     
 * @param {string} prefix   
 * @param {object} [opts]
 * @param {mongoose.ClientSession} [opts.session]  
 * @returns {Promise<string>}
 */
const generateSequentialId = async (
  name,
  prefix,
  { session, padding = 6 } = {},
) => {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session },
  );

  const padded = String(counter.seq).padStart(padding, "0");
  return `${prefix}-${padded}`;
};

export default generateSequentialId;