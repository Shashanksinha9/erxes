/* eslint-env jest */
/* eslint-disable no-underscore-dangle */

import Twit from 'twit';
import sinon from 'sinon';
import faker from 'faker';
import { connect, disconnect, graphqlRequest } from '../db/connection';
import { Conversations, ConversationMessages, Users, Customers, Integrations } from '../db/models';
import {
  conversationFactory,
  conversationMessageFactory,
  userFactory,
  integrationFactory,
  customerFactory,
} from '../db/factories';
import { TwitMap } from '../social/twitter';
import { twitRequest } from '../social/twitterTracker';
import utils from '../data/utils';

beforeAll(() => connect());

afterAll(() => disconnect());

const toJSON = value => {
  return JSON.stringify(value);
};

describe('Conversation message mutations', () => {
  let _conversation;
  let _conversationMessage;
  let _user;
  let _integration;
  let _customer;
  let context;

  beforeEach(async () => {
    // Creating test data
    _conversation = await conversationFactory();
    _conversationMessage = await conversationMessageFactory();
    _user = await userFactory();
    _customer = await customerFactory();
    _integration = await integrationFactory({ kind: 'form' });
    _conversation.integrationId = _integration._id;
    _conversation.customerId = _customer._id;
    _conversation.assignedUserId = _user._id;

    await _conversation.save();

    context = { user: _user };
  });

  afterEach(async () => {
    // Clearing test data
    await Conversations.remove({});
    await ConversationMessages.remove({});
    await Users.remove({});
    await Integrations.remove({});
    await Customers.remove({});

    // restore mocks
    if (utils.sendNotification.mock) {
      utils.sendNotification.mockRestore();
    }
  });

  test('Add conversation message', async () => {
    const args = {
      conversationId: _conversation._id,
      content: _conversationMessage.content,
      mentionedUserIds: [_user._id],
      internal: false,
      attachments: [{}],
      tweetReplyToId: faker.random.number(),
      tweetReplyToScreenName: faker.name.firstName(),
    };

    const mutation = `
      mutation conversationMessageAdd(
        $conversationId: String
        $content: String
        $mentionedUserIds: [String]
        $internal: Boolean
        $attachments: [JSON]
        $tweetReplyToId: String
        $tweetReplyToScreenName: String
      ) {
        conversationMessageAdd(
          conversationId: $conversationId
          content: $content
          mentionedUserIds: $mentionedUserIds
          internal: $internal
          attachments: $attachments
          tweetReplyToId: $tweetReplyToId
          tweetReplyToScreenName: $tweetReplyToScreenName
        ) {
          conversationId
          content
          mentionedUserIds
          internal
          attachments
        }
      }
    `;

    const conversation = await graphqlRequest(mutation, 'conversationMessageAdd', args);

    expect(conversation.content).toBe(args.content);
    expect(conversation.attachments).toEqual([{}]);
    expect(toJSON(conversation.mentionedUserIds)).toEqual(toJSON(args.mentionedUserIds));
    expect(conversation.conversationId).toBe(args.conversationId);
    expect(conversation.internal).toBe(args.internal);
  });

  test('Tweet conversation', async () => {
    const integration = await integrationFactory({ kind: 'twitter' });

    // Twit instance
    const twit = new Twit({
      consumer_key: 'consumer_key',
      consumer_secret: 'consumer_secret',
      access_token: 'access_token',
      access_token_secret: 'token_secret',
    });

    // save twit instance
    TwitMap[integration._id] = twit;

    const args = {
      integrationId: integration._id,
      text: faker.random.word(),
    };

    // mock twitter request
    const sandbox = sinon.sandbox.create();

    const stub = sandbox.stub(twitRequest, 'post').callsFake(() => {
      return new Promise(resolve => {
        resolve({});
      });
    });

    const mutation = `
      mutation conversationsTweet($integrationId: String $text: String) {
        conversationsTweet(integrationId: $integrationId text: $text)
      }
    `;

    await graphqlRequest(mutation, 'conversationsTweet', args);

    // check twit post params
    expect(
      stub.calledWith(twit, 'statuses/update', {
        status: args.text,
      }),
    ).toBe(true);

    stub.restore();
  });

  test('Assign conversation', async () => {
    const args = {
      conversationIds: [_conversation._id],
      assignedUserId: _user._id,
    };

    const mutation = `
      mutation conversationsAssign(
        $conversationIds: [String]!
        $assignedUserId: String
      ) {
        conversationsAssign(
          conversationIds: $conversationIds
          assignedUserId: $assignedUserId
        ) {
          assignedUser {
            _id
          }
        }
      }
    `;

    const [conversation] = await graphqlRequest(mutation, 'conversationsAssign', args, context);

    expect(conversation.assignedUser._id).toEqual(args.assignedUserId);
  });

  test('Unassign conversation', async () => {
    const mutation = `
      mutation conversationsUnassign($_ids: [String]!) {
        conversationsUnassign(_ids: $_ids) {
          assignedUser {
            _id
          }
        }
      }
    `;

    const [conversation] = await graphqlRequest(mutation, 'conversationsUnassign', {
      _ids: [_conversation._id],
    });

    expect(conversation.assignedUser).toBe(null);
  });

  test('Change conversation status', async () => {
    const args = {
      _ids: [_conversation._id],
      status: 'closed',
    };

    const mutation = `
      mutation conversationsChangeStatus($_ids: [String]!, $status: String!) {
        conversationsChangeStatus(_ids: $_ids, status: $status) {
          status
        }
      }
    `;

    const [conversation] = await graphqlRequest(mutation, 'conversationsChangeStatus', args);

    expect(conversation.status).toEqual(args.status);
  });

  test('Star conversation', async () => {
    const mutation = `
      mutation conversationsStar($_ids: [String]!) {
        conversationsStar(_ids: $_ids) {
          _id
        }
      }
    `;

    const userId = await graphqlRequest(
      mutation,
      'conversationsStar',
      { _ids: [_conversation._id] },
      context,
    );

    const user = await Users.findOne({ _id: userId });

    expect(user.starredConversationIds).toContain([_conversation._id]);
  });

  test('Unstar conversation', async () => {
    const mutation = `
      mutation conversationsUnstar($_ids: [String]!) {
        conversationsUnstar(_ids: $_ids) {
          _id
        }
      }
    `;

    const userId = await graphqlRequest(
      mutation,
      'conversationsUnstar',
      { _ids: [_conversation._id] },
      context,
    );

    const user = await Users.findOne({ _id: userId });

    expect(user.starredConversationIds).not.toContain([_conversation._id]);
  });

  test('Toggle conversation participate', async () => {
    const mutation = `
      mutation conversationsToggleParticipate($_ids: [String]!) {
        conversationsToggleParticipate(_ids: $_ids) {
          _id
        }
      }
    `;

    const [conversationIds] = await graphqlRequest(
      mutation,
      'conversationsToggleParticipate',
      { _ids: [_conversation._id] },
      context,
    );

    const [conversation] = await Conversations.find({ _id: { $in: conversationIds } });

    expect(conversation.participatedUserIds).toContain(_user._id);
  });

  test('Mark conversation as read', async () => {
    const mutation = `
      mutation conversationMarkAsRead($_id: String) {
        conversationMarkAsRead(_id: $_id) {
          _id
          readUserIds
        }
      }
    `;

    const conversation = await graphqlRequest(
      mutation,
      'conversationMarkAsRead',
      { _id: _conversation._id },
      context,
    );

    expect(conversation.readUserIds).toContain(_user._id);
  });
});
