import * as dotenv from 'dotenv';
import { stream } from '../data/bulkUtils';
import { connect } from '../db/connection';
import { Conversations, Customers } from '../db/models';

dotenv.config();

const command = async () => {
  console.log(`Process started at: ${new Date()}`);

  const argv = process.argv;
  const limit = parseInt(argv[2] || '50000', 10);

  await connect();

  const usedCustomerIds = await Conversations.find(
    { customerId: { $exists: true } },
    { customerId: 1 }
  ).distinct('customerId');

  console.log('used customers', usedCustomerIds, usedCustomerIds);

  const customers = await Customers.aggregate([
    { $match: { $and: [{ state: 'visitor' }, { profileScore: 0 }] } },
    { $project: { _id: '$_id' } },
    { $limit: limit }
  ]);

  const customerIds = customers.map(c => c._id);

  console.log('visitors', customerIds, customerIds.length);

  const idsToRemove = customerIds.filter(e => !usedCustomerIds.includes(e));

  console.log('idsToRemove', idsToRemove.length);

  let deletedCount = 0;

  await stream(
    async chunk => {
      deletedCount = deletedCount + chunk.length;
      console.log('deletedCount', deletedCount);
      await Customers.deleteMany({ _id: { $in: chunk } });
    },
    (variables, root) => {
      const parentIds = variables.parentIds || [];

      parentIds.push(root._id);

      variables.parentIds = parentIds;
    },
    () => {
      return Customers.find(
        {
          _id: { $in: idsToRemove }
        },
        { _id: 1 }
      ) as any;
    },
    1000
  );
};

command().then(() => {
  console.log(`Process finished at: ${new Date()}`);
  process.exit();
});
