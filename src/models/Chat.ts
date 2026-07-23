import mongoose , {Document , Schema} from "mongoose";

export interface IChat extends Document {
    users : string[];
    latestMessage : {
        text : string;
        sender : string;
    }
    createdAt : Date;
    updatedAt : Date;
}

const ChatSchema : Schema = new Schema({
    users : [
        {type : String , required : true}
    ],
    latestMessage : {
        text : {type : String , required : false},
        sender : {type : String , required : false}
    }
} , {timestamps : true});

export const Chat = mongoose.model<IChat>("Chat" , ChatSchema);